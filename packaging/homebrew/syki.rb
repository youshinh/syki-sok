cask "syki" do
  version "2.0.14"
  sha256 :no_check

  url "https://github.com/youshinh/syki-sok/releases/download/v#{version}/syki-macos.zip"
  name "syki::sok"
  desc "Ultra-lightweight, high-speed, AI-native Markdown & text editor"
  homepage "https://github.com/youshinh/syki-sok"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "syki-sok.app"
  binary "#{appdir}/syki-sok.app/Contents/MacOS/syki-sok", target: "syki"

  zap trash: [
    "~/Library/Application Support/syki-sok",
    "~/Library/Application Support/md-memo",
    "~/Library/Saved Application State/com.youshinh.syki-sok.savedState",
    "~/Library/Preferences/com.youshinh.syki-sok.plist",
  ]

  caveats <<~EOS
    syki-sok.app is ad-hoc signed, not notarized by Apple. On first launch,
    Gatekeeper will refuse to open it (a dialog saying Apple could not verify
    that it is free of malware). To run it:

      macOS 15 (Sequoia) or later:
        Click "Done" in the dialog, open System Settings > Privacy & Security,
        scroll to "Security", click "Open Anyway" and enter your login
        password. The button is shown for about an hour after the attempt.
      macOS 14 or earlier:
        Right-click (or Control-click) syki-sok.app in Finder and choose "Open".
      Any version:
        xattr -dr com.apple.quarantine "#{appdir}/syki-sok.app"

    This is only required once per install/update.
  EOS
end
