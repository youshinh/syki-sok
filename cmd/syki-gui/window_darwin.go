//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit

#include <stdlib.h>
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
// kAEQuitReason (AERegistry.h). Header only: the constant is an enum, nothing extra is linked.
#import <CoreServices/CoreServices.h>

// gWindow is syki::sok's one and only NSWindow. It is captured in setupMacWindowDelegate from
// the pointer webview hands back, and is read only from the main queue.
//
// Keeping it here is what makes the window controls work at all: webview's cocoa engine
// exposes no way to miniaturize, zoom or re-front its window, and App.CloseWindow used to be
// wired to every one of minimize / quit / close, which destroyed the webview and left the
// process running with no window and no way to get one back.
static NSWindow *gWindow = nil;

// Forward declaration with external linkage on purpose: hotkey_darwin.go is a separate cgo
// translation unit and its Carbon hot-key handler calls this function.
void sykiActivateWindow(void);

// sykiActivateWindowOnMain brings the app and its window to the front. It touches AppKit
// and must therefore only ever be called on the main thread.
static void sykiActivateWindowOnMain(void) {
    NSApplication *app = [NSApplication sharedApplication];
    [app activateIgnoringOtherApps:YES];
    if (gWindow != nil) {
        if ([gWindow isMiniaturized]) {
            [gWindow deminiaturize:nil];
        }
        [gWindow makeKeyAndOrderFront:nil];
    }
}

// Defined in Go (openfile_darwin.go, //export): hands one path to the app. It is only declared
// here because a Go file with //export directives may not define anything in its preamble, and
// the Objective-C below needs definitions.
extern void sykiGoOpenFile(char *path);

// Defined in Go (openfile_darwin.go, //export), declared here for the same reason. It starts the
// same exit App.CloseWindow uses (closePlatformWindow: stop the run loop so webview_run returns
// and main's defers run) and returns 1, or returns 0 when Go has no window to stop yet.
extern int sykiGoQuit(void);

// --- Quitting ----------------------------------------------------------------------------------
//
// Cmd+Q, the app menu's Quit item, Dock > Quit and a logout all end in [NSApp terminate:]. Left
// alone, that calls exit() straight away: main's deferred ipcServer.Close() never runs (so
// ipc-session.json is left behind) and the page never saves the edits of the last half second
// (its session save is debounced by 500 ms, and WKWebView fires no beforeunload on exit).
// applicationShouldTerminate: below routes every quit through one path instead:
//
//   1. ask the page to save its session (kSykiQuitFlushScript), waiting at most
//      kSykiQuitFlushTimeout for the answer;
//   2. a quit the user asked for (Cmd+Q, Dock > Quit) is cancelled as far as AppKit is concerned
//      and finished by Go the way App.CloseWindow does it, so every defer runs. If the process is
//      somehow still alive kSykiQuitStopTimeout later, AppKit is told to terminate for real;
//   3. a logout, restart or shutdown must never be cancelled (the system would abandon the
//      logout), so it answers NSTerminateLater and then YES once the page has saved: AppKit exits
//      as before, minus the lost edits. ipc-session.json may stay behind in that case; the next
//      launch purges it (ipc.LoadSession checks the recorded PID).
//
// Every branch ends in the process exiting; none of them can leave the app refusing to quit. A
// second Cmd+Q while the first is still finishing is ignored; a logout during it quits at once.
// No prompt about unsaved changes is added: dirty tabs live on in the saved session, exactly as
// they did when Cmd+Q simply exited.

enum {
    kSykiQuitIdle = 0,     // no quit requested yet
    kSykiQuitFlushing = 1, // waiting for the page to save (or for the flush timeout)
    kSykiQuitStopping = 2, // Go is stopping the run loop
    kSykiQuitNow = 3       // let AppKit terminate immediately
};

// Main-thread only, like everything else that touches them.
static int gQuitState = kSykiQuitIdle;
static BOOL gQuitFromSystem = NO;
// Set by NSWorkspaceWillPowerOffNotification, which is posted before a logout, restart or shutdown
// asks the apps to quit. A second signal besides the quit event's reason attribute, so a logout
// is never mistaken for Cmd+Q (and cancelled).
static BOOL gPoweringOff = NO;

static const double kSykiQuitFlushTimeout = 2.0;
static const double kSykiQuitStopTimeout = 3.0;

// Hands the page's current session to Go (SaveSession) before the app goes away. The listener
// app.js registers for beforeunload does exactly that, synchronously, so it is simply fired; a
// window.__sykiBeforeQuit function, if the page ever defines one, is preferred. The
// saveSession message is posted before this script returns, so it reaches Go before the
// completion handler of evaluateJavaScript runs.
static NSString *const kSykiQuitFlushScript =
    @"(function () {"
    @"  try {"
    @"    if (typeof window.__sykiBeforeQuit === 'function') {"
    @"      window.__sykiBeforeQuit();"
    @"    } else {"
    @"      window.dispatchEvent(new Event('beforeunload'));"
    @"    }"
    @"  } catch (e) {}"
    @"  return true;"
    @"})();";

// sykiQuitIsFromSystem reports whether the quit being handled comes from a logout, restart or
// shutdown. Cmd+Q and the Quit menu item call terminate: directly (no current Apple Event);
// Dock > Quit sends a plain quit event; the system's quit event carries a kAEQuitReason
// attribute. Any reason at all counts as "system": misreading a user quit that way only costs the
// ipc-session.json cleanup, while misreading a logout as a user quit would cancel the logout.
static BOOL sykiQuitIsFromSystem(void) {
    if (gPoweringOff) {
        return YES;
    }
    NSAppleEventDescriptor *event = [[NSAppleEventManager sharedAppleEventManager] currentAppleEvent];
    if (event == nil) {
        return NO;
    }
    return [event attributeDescriptorForKeyword:kAEQuitReason] != nil;
}

// sykiFinishQuitOnMain runs once the page has saved, or once the flush timeout fires, whichever
// comes first; the second call finds the state already moved on and does nothing.
static void sykiFinishQuitOnMain(void) {
    if (gQuitState != kSykiQuitFlushing) {
        return;
    }
    NSApplication *app = [NSApplication sharedApplication];
    if (gQuitFromSystem) {
        gQuitState = kSykiQuitNow;
        [app replyToApplicationShouldTerminate:YES];
        return;
    }
    gQuitState = kSykiQuitStopping;
    if (sykiGoQuit() == 0) {
        gQuitState = kSykiQuitNow;
        [app terminate:nil];
        return;
    }
    // Normally the run loop has returned long before this fires (and a stopped run loop never
    // runs it). It is only here so that "the app quits" holds even if stopping failed, e.g.
    // because a modal panel swallowed the stop.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kSykiQuitStopTimeout * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        @autoreleasepool {
            gQuitState = kSykiQuitNow;
            [[NSApplication sharedApplication] terminate:nil];
        }
    });
}

// sykiFlushPageThenFinishQuit asks the page to save and arranges for sykiFinishQuitOnMain to
// run afterwards. It never calls it synchronously: applicationShouldTerminate: has to return
// NSTerminateLater before replyToApplicationShouldTerminate: may be sent.
static void sykiFlushPageThenFinishQuit(void) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kSykiQuitFlushTimeout * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        @autoreleasepool {
            sykiFinishQuitOnMain();
        }
    });

    WKWebView *webView = nil;
    if (gWindow != nil) {
        NSView *content = [gWindow contentView];
        if (content != nil && [content isKindOfClass:[WKWebView class]]) {
            webView = (WKWebView *)content;
        }
    }
    if (webView == nil) {
        dispatch_async(dispatch_get_main_queue(), ^{
            @autoreleasepool {
                sykiFinishQuitOnMain();
            }
        });
        return;
    }
    [webView evaluateJavaScript:kSykiQuitFlushScript completionHandler:^(id result, NSError *error) {
        sykiFinishQuitOnMain();
    }];
}

@interface SykiAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate>
@end

@implementation SykiAppDelegate
// Finder's "Open With", a double-click on a .md file and a drop on the Dock icon arrive here (as
// an Apple Event, never as a command-line argument). Info.plist declares the document types, so
// without this method AppKit answers "syki::sok cannot open files in the "Markdown Document" format".
// The path goes to Go, which shows it in a tab (app_openfiles.go).
- (void)application:(NSApplication *)sender openFiles:(NSArray<NSString *> *)filenames {
    for (NSString *name in filenames) {
        const char *path = [name fileSystemRepresentation];
        if (path != NULL) {
            sykiGoOpenFile((char *)path);
        }
    }
    [sender replyToOpenOrPrint:NSApplicationDelegateReplySuccess];
}

// See "Quitting" above.
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    if (gQuitState == kSykiQuitNow) {
        return NSTerminateNow;
    }
    BOOL fromSystem = sykiQuitIsFromSystem();
    if (gQuitState != kSykiQuitIdle) {
        // A quit is already under way. A logout must not wait for it; anything else just lets
        // the one in progress finish.
        return fromSystem ? NSTerminateNow : NSTerminateCancel;
    }
    gQuitState = kSykiQuitFlushing;
    gQuitFromSystem = fromSystem;
    sykiFlushPageThenFinishQuit();
    return fromSystem ? NSTerminateLater : NSTerminateCancel;
}

- (void)workspaceWillPowerOff:(NSNotification *)notification {
    gPoweringOff = YES;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
    // This used to walk [sender windows] and order each one front, which did nothing after
    // the window had been hidden (and nothing at all once it had been destroyed) and never
    // activated the app. Go through the one real activation path instead.
    sykiActivateWindowOnMain();
    return YES;
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    [sender orderOut:nil];
    return NO;
}
@end

static SykiAppDelegate *gAppDelegate = nil;

// sykiInstallAppDelegate makes SykiAppDelegate NSApp's delegate. It must run synchronously on
// the main thread BEFORE webview.New, never from a dispatch_async block:
//
// When NSApp has no delegate, webview's cocoa engine installs its own (WebviewAppDelegate, which
// has no application:openFiles:) and spins [NSApp run] inside webview.New until
// applicationDidFinishLaunching: arrives. AppKit delivers the file a cold launch was started with
// (Finder "Open With", a double-click, a drop on the Dock icon) BEFORE
// applicationDidFinishLaunching:, so while our delegate was installed from a dispatch_async block
// that file always reached webview's delegate and AppKit answered "syki::sok cannot open files in
// the "Markdown Document" format". (It had to come later than that, too: had the block ever won
// the race, webview's delegate would never have seen applicationDidFinishLaunching: and
// webview.New would have spun forever.)
//
// With a delegate already set, webview.New skips that temporary run loop and builds the window at
// once. Everything the skipped applicationDidFinishLaunching: did is covered: the window is set up
// by the constructor itself, and setupMacEditMenu sets the activation policy and activates the
// app. The first [NSApp run] is then w.Run(), after every Bind, and the launch file reaches
// application:openFiles: there, to wait in the osOpen queue for GetStartupFile.
static void sykiInstallAppDelegate(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        if (gAppDelegate == nil) {
            gAppDelegate = [[SykiAppDelegate alloc] init];
            [[[NSWorkspace sharedWorkspace] notificationCenter] addObserver:gAppDelegate
                                                                   selector:@selector(workspaceWillPowerOff:)
                                                                       name:NSWorkspaceWillPowerOffNotification
                                                                     object:nil];
        }
        [app setDelegate:gAppDelegate];
    }
}

// sykiActivateWindow is the thread-safe entry point used from Go and from the hot-key
// handler.
void sykiActivateWindow(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            sykiActivateWindowOnMain();
        }
    });
}

// sykiMinimizeWindow miniaturizes the window to the Dock. There is no tray on macOS, so
// "minimize" means exactly that.
static void sykiMinimizeWindow(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            if (gWindow != nil) {
                [gWindow miniaturize:nil];
            }
        }
    });
}

// sykiToggleFullScreen is the macOS counterpart of the Windows maximize/restore toggle.
// It needs NSWindowStyleMaskResizable, which setupMacWindowDelegate guarantees.
static void sykiToggleFullScreen(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            if (gWindow != nil) {
                [gWindow toggleFullScreen:nil];
            }
        }
    });
}

// sykiApplyBackdrop paints what the OS draws behind the page in the colour of the look (nativelook.go): the window's own background and
// the web view's under-page colour. The colour is sRGB, like the page's canvas (--canvas-bg); the calibrated colour space the code used
// before is a few steps off. Main queue only.
static void sykiApplyBackdrop(NSWindow *win, double r, double g, double b) {
    NSColor *colour = [NSColor colorWithSRGBRed:r green:g blue:b alpha:1.0];

    // Without it the window paints white for the frames before the page renders.
    [win setBackgroundColor:colour];

    // The WKWebView (webview installs it as the content view) draws an opaque white
    // backdrop of its own, which would cover the colour set above and cause a white
    // flash before the page loads. underPageBackgroundColor is the public, documented
    // WebKit API for exactly this, but only exists on macOS 12+; guard with @available
    // (which also silences -Wunguarded-availability-new) rather than a private KVC key
    // + @try/@catch, since Go's cgo does not allow the -fobjc-exceptions flag that
    // non-ARC exception handling would otherwise need. respondsToSelector: is kept as a
    // second, redundant guard in case a future SDK ever ships the selector without the
    // matching deployment-target availability annotation.
    NSView *content = [win contentView];
    if (content != nil && [content respondsToSelector:@selector(setUnderPageBackgroundColor:)]) {
        if (@available(macOS 12.0, *)) {
            WKWebView *webView = (WKWebView *)content;
            [webView setUnderPageBackgroundColor:colour];
        }
    }
}

// sykiSetBackdrop follows a look chosen in the settings while the app runs (App.SaveConfig -> noteNativeLook).
static void sykiSetBackdrop(double r, double g, double b) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            if (gWindow != nil) {
                sykiApplyBackdrop(gWindow, r, g, b);
            }
        }
    });
}

static void setupMacWindowDelegate(void *nsWindow, double r, double g, double b) {
    if (nsWindow == NULL) return;
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            NSWindow *win = (NSWindow *)nsWindow;
            // Retained for the lifetime of the process: this file is compiled without ARC,
            // and the pointer has to stay valid for every later miniaturize / activate.
            gWindow = [win retain];

            if (gAppDelegate != nil) {
                [win setDelegate:gAppDelegate];
            }

            // Some webview releases create the NSWindow with NSWindowStyleMaskTitled alone.
            // Without these bits miniaturize:, zoom: and toggleFullScreen: are silent no-ops,
            // and the window has no minimize/zoom buttons at all. OR-ing is idempotent, so
            // this is harmless on the releases that already set them.
            [win setStyleMask:([win styleMask] |
                               NSWindowStyleMaskClosable |
                               NSWindowStyleMaskMiniaturizable |
                               NSWindowStyleMaskResizable)];

            // The colour of the saved look, the same one the page paints as its canvas (nativelook.go).
            sykiApplyBackdrop(win, r, g, b);
        }
    });
}

static void setupMacEditMenu(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            NSApplication *app = [NSApplication sharedApplication];
            [app setActivationPolicy:NSApplicationActivationPolicyRegular];

            // The app delegate is not installed here any more: see sykiInstallAppDelegate.

            NSMenu *mainMenu = [[NSMenu alloc] init];

            // 1. Application Menu
            NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
            NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"syki"];
            NSString *appName = @"syki";
            [appMenu addItemWithTitle:[NSString stringWithFormat:@"About %@", appName]
                               action:@selector(orderFrontStandardAboutPanel:)
                        keyEquivalent:@""];
            [appMenu addItem:[NSMenuItem separatorItem]];
            [appMenu addItemWithTitle:[NSString stringWithFormat:@"Hide %@", appName]
                               action:@selector(hide:)
                        keyEquivalent:@"h"];
            NSMenuItem *hideOthers = [[NSMenuItem alloc] initWithTitle:@"Hide Others"
                                                                action:@selector(hideOtherApplications:)
                                                         keyEquivalent:@"h"];
            [hideOthers setKeyEquivalentModifierMask:(NSEventModifierFlagOption | NSEventModifierFlagCommand)];
            [appMenu addItem:hideOthers];
            [appMenu addItemWithTitle:@"Show All"
                               action:@selector(unhideAllApplications:)
                        keyEquivalent:@""];
            [appMenu addItem:[NSMenuItem separatorItem]];
            // terminate: is answered by SykiAppDelegate's applicationShouldTerminate:, which
            // saves the session and exits through the same path as App.CloseWindow.
            [appMenu addItemWithTitle:[NSString stringWithFormat:@"Quit %@", appName]
                               action:@selector(terminate:)
                        keyEquivalent:@"q"];
            [appMenuItem setSubmenu:appMenu];
            [mainMenu addItem:appMenuItem];

            // 2. Edit Menu (Crucial for Cut, Copy, Paste, Select All, Undo, Redo)
            NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
            NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];

            [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
            NSMenuItem *redoItem = [[NSMenuItem alloc] initWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
            [editMenu addItem:redoItem];
            [editMenu addItem:[NSMenuItem separatorItem]];
            [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
            [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
            [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
            [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];

            [editMenuItem setSubmenu:editMenu];
            [mainMenu addItem:editMenuItem];

            // 3. Window Menu. Its only job is to let AppKit handle Cmd+M itself: the
            // frontend's own minimize shortcut goes through backend_minimizeWindow, but a Mac
            // user expects Cmd+M to work whether or not the web page has focus, and without a
            // Window menu AppKit has nothing to route it to.
            NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
            NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
            [windowMenu addItemWithTitle:@"Minimize"
                                  action:@selector(performMiniaturize:)
                           keyEquivalent:@"m"];
            [windowMenu addItemWithTitle:@"Zoom"
                                  action:@selector(performZoom:)
                           keyEquivalent:@""];
            [windowMenuItem setSubmenu:windowMenu];
            [mainMenu addItem:windowMenuItem];

            [app setMainMenu:mainMenu];
            [app setWindowsMenu:windowMenu];
            [app activateIgnoringOtherApps:YES];
        }
    });
}

// --- Printing the preview ----------------------------------------------------------------------
//
// WKWebView has no window.print(), and createPDF would make one long page with the screen style, so
// the page is printed with NSPrintOperation (macOS 11+): the system's own print dialog, whose "PDF"
// menu has "Save as PDF" (the paper, the orientation and the scale are chosen there). css/print.css
// is the paper look (WebKit applies the print media to it) and print_preview.js has already drawn
// the diagrams light; the page is told how it ended so that they go back (window.__onPrintPdfResult,
// the shim's __sykiSettle). The title is what "Save as PDF" offers as the file name. No header or
// footer: WKWebView prints none and has no way to ask for one.

static WKWebView *sykiWebView(void) {
    if (gWindow == nil) {
        return nil;
    }
    NSView *content = [gWindow contentView];
    if (content != nil && [content isKindOfClass:[WKWebView class]]) {
        return (WKWebView *)content;
    }
    return nil;
}

static void sykiReportPrintResult(NSString *reqID, BOOL printed) {
    WKWebView *webView = sykiWebView();
    if (webView == nil || reqID == nil) {
        return;
    }
    // reqID is made of letters, digits and underscores by the page (printSystem_<n>_<time>)
    NSString *script = [NSString stringWithFormat:
        @"if (window.__onPrintPdfResult) { window.__onPrintPdfResult(\"%@\", %@, \"\"); }",
        reqID, printed ? @"true" : @"false"];
    [webView evaluateJavaScript:script completionHandler:nil];
}

@interface SykiPrintDelegate : NSObject
@end

@implementation SykiPrintDelegate
// contextInfo is the request id, retained by sykiPrintWebView.
- (void)printOperationDidRun:(NSPrintOperation *)printOperation success:(BOOL)success contextInfo:(void *)contextInfo {
    NSString *reqID = (NSString *)contextInfo;
    sykiReportPrintResult(reqID, success);
    [reqID release];
}
@end

static SykiPrintDelegate *gPrintDelegate = nil;

// sykiPrintWebView opens the print dialog for the page (a sheet on the window; the window not on
// screen gets the application's own panel). It answers the page's request when the dialog is closed:
// true when it printed or saved, false when it was cancelled or could not be shown.
static void sykiPrintWebView(const char *reqIDC, const char *titleC) {
    if (reqIDC == NULL) {
        return;
    }
    NSString *reqID = [NSString stringWithUTF8String:reqIDC];
    NSString *title = (titleC != NULL) ? [NSString stringWithUTF8String:titleC] : nil;
    if (reqID == nil) {
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            WKWebView *webView = sykiWebView();
            if (webView == nil) {
                sykiReportPrintResult(reqID, NO);
                return;
            }
            if (@available(macOS 11.0, *)) {
                // 20 mm all round, as css/print.css and the Windows panel's "normal" margins; the paper and the
                // orientation start as the system's defaults and are changed in the dialog.
                NSPrintInfo *info = [[[NSPrintInfo sharedPrintInfo] copy] autorelease];
                CGFloat margin = 20.0 * 72.0 / 25.4;
                [info setTopMargin:margin];
                [info setBottomMargin:margin];
                [info setLeftMargin:margin];
                [info setRightMargin:margin];
                NSPrintOperation *op = [webView printOperationWithPrintInfo:info];
                if (op == nil) {
                    sykiReportPrintResult(reqID, NO);
                    return;
                }
                [op setShowsPrintPanel:YES];
                [op setShowsProgressPanel:YES];
                // The panel offers only the copies, the pages and the preview unless it is asked for more: the paper, its orientation and
                // the scale are the person's to choose here (v1.11.0 left them out).
                NSPrintPanel *panel = [op printPanel];
                [panel setOptions:([panel options] | NSPrintPanelShowsPaperSize | NSPrintPanelShowsOrientation | NSPrintPanelShowsScaling)];
                if (title != nil && [title length] > 0) {
                    [op setJobTitle:title];
                }
                // WKWebView's printing view starts with no size, and the pages come out blank without one.
                NSView *printView = [op view];
                if (printView != nil) {
                    NSSize paper = [info paperSize];
                    [printView setFrame:NSMakeRect(0, 0, paper.width, paper.height)];
                }
                if (gPrintDelegate == nil) {
                    gPrintDelegate = [[SykiPrintDelegate alloc] init];
                }
                if (gWindow != nil && [gWindow isVisible] && ![gWindow isMiniaturized]) {
                    [op runOperationModalForWindow:gWindow
                                          delegate:gPrintDelegate
                                    didRunSelector:@selector(printOperationDidRun:success:contextInfo:)
                                       contextInfo:(void *)[reqID retain]];
                } else {
                    BOOL printed = [op runOperation];
                    sykiReportPrintResult(reqID, printed);
                }
            } else {
                sykiReportPrintResult(reqID, NO);
            }
        }
    });
}
*/
import "C"

import (
	"log"
	"sync/atomic"
	"unsafe"

	"github.com/webview/webview_go"
)

// backdropRGB is the colour of a look as the 0..1 components the Objective-C side takes.
func backdropRGB(l nativeLook) (C.double, C.double, C.double) {
	return C.double(l.R) / 255, C.double(l.G) / 255, C.double(l.B) / 255
}

// setNativeLook repaints the window and web view for a look chosen while the app runs. Safe from any goroutine: the Objective-C side
// hops to the main queue itself.
func setNativeLook(l nativeLook) {
	r, g, b := backdropRGB(l)
	C.sykiSetBackdrop(r, g, b)
}

func runPlatformWindow(app *App, serverURL string) {
	// Before the run loop starts: a file that launched the app is delivered as soon as it runs.
	setOSOpenHandler(app.OpenFromOS)

	// Synchronously and before webview.New, so a file that launched the app reaches our
	// application:openFiles: (see sykiInstallAppDelegate). webview_go's init has locked this
	// goroutine to the main thread.
	C.sykiInstallAppDelegate()
	C.setupMacEditMenu()

	w := webview.New(false)
	if w == nil {
		return
	}
	defer func() {
		atomic.StoreInt32(&app.isDestroyed, 1)
		w.Destroy()
	}()

	app.w = w

	// Cmd+Q, the Quit menu item and Dock > Quit end here once the page has saved its session
	// (applicationShouldTerminate: in the preamble): the same exit as App.CloseWindow, so this
	// function's and main's defers run and ipc-session.json is removed.
	setOSQuitHandler(func() { closePlatformWindow(app) })

	w.SetTitle("syki")
	w.SetSize(1050, 720, webview.HintNone)

	// The window and web view start in the colour of the saved look, and follow it when the settings are saved with another one.
	look := app.startupNativeLook()
	bgR, bgG, bgB := backdropRGB(look)
	C.setupMacWindowDelegate(w.Window(), bgR, bgG, bgB)
	app.setNativeLookApplier(setNativeLook)

	// Register the configured global summon shortcut, exactly as the Windows path does. It is
	// dispatched onto the main queue so it still runs once [NSApp run] has started (webview.New
	// no longer spins a temporary run loop, see sykiInstallAppDelegate), i.e. after
	// finishLaunching, as it always did.
	w.Dispatch(func() {
		if !updateGlobalHotKeyNative(initialGlobalShortcut(app)) {
			log.Printf("global summon hotkey could not be registered")
		}
	})

	// Bind Go RPC methods. bindCommonBackend (bind_common.go) covers every backend_X -> app.Y
	// bind that is identical on Windows and macOS; only the inline-closure and platform-specific
	// binds are listed here.
	bindCommonBackend(w, app)
	// Minimize really minimizes, and quit really quits. Both were wired to App.CloseWindow,
	// which destroyed the webview: the NSWindow went away, NSApp kept running, and the
	// process survived with no window, no Dock reopen path and its HTTP/IPC listeners still
	// bound - unreachable and unkillable short of Activity Monitor.
	_ = w.Bind("backend_minimizeWindow", func() error {
		C.sykiMinimizeWindow()
		return nil
	})
	_ = w.Bind("backend_toggleMaximize", func() error {
		C.sykiToggleFullScreen()
		return nil
	})
	// macOS has one "full screen" (its own space, no title bar, the Dock and menu bar tucked away): the same call.
	_ = w.Bind("backend_toggleFullscreen", func() error {
		C.sykiToggleFullScreen()
		return nil
	})
	_ = w.Bind("backend_forceQuit", app.CloseWindow)
	// The printer button of the preview: the system's print dialog for the page (see "Printing the preview" in the
	// preamble). It answers through window.__onPrintPdfResult when the dialog is closed.
	_ = w.Bind("backend_printSystemAsync", func(reqID, title string) error {
		cReq := C.CString(reqID)
		cTitle := C.CString(title)
		defer C.free(unsafe.Pointer(cReq))
		defer C.free(unsafe.Pointer(cTitle))
		C.sykiPrintWebView(cReq, cTitle)
		return nil
	})
	// There is no honest native IME switch on macOS yet (see F9 / GetPlatformCapabilities):
	// TIS input-source switching is a separate, riskier piece of work. The bind stays a
	// no-op, and backend_getPlatformCapabilities now tells the frontend so explicitly
	// instead of letting the IME Guardian assume it worked.
	_ = w.Bind("backend_setIMEMode", func(enableJapanese bool) error { return nil })

	w.Init(buildCommonBridgeInitJS([]string{
		`printSystem: (title) => window.__sykiAsync('printSystem_', 600000, (reqID) => window.backend_printSystemAsync(reqID, title || ''))`,
	}))

	w.Navigate(serverURL)
	w.Run()
}

// activatePlatformWindow fronts the window for the "pipe" and "activate" IPC actions. It was
// an empty function, so `syki` launched a second time, or `something | syki`, appended
// the scrap and left the window exactly where it was - usually behind whatever the user was
// looking at, or miniaturized in the Dock.
//
// trimProcessWorkingSet, closePlatformWindow, checkSingleInstance and initialGlobalShortcut used
// to live below this function. They call no C.* function, so they were moved to
// platform_darwin.go (no import "C", `//go:build darwin` only) so they - and the rest of this
// package - still type-check with CGO_ENABLED=0 (see platform_darwin_nocgo.go for the stubs that
// replace the cgo-only functions that remain here).
func activatePlatformWindow() {
	C.sykiActivateWindow()
}
