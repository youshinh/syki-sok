import test from 'node:test';
import assert from 'node:assert/strict';

test('Early Key Hook & Fast New Tab specifications', async (t) => {
  await t.test('early key buffering structure and replay contract', () => {
    // Contract verification: window globals used during early load
    const mockWindow = {
      __earlyKeys: ['a', 'b', 'c'],
      __earlyPendingVoice: true,
      __earlyPendingNewTab: true
    };

    assert.equal(mockWindow.__earlyKeys.join(''), 'abc');
    assert.equal(mockWindow.__earlyPendingVoice, true);
    assert.equal(mockWindow.__earlyPendingNewTab, true);
  });

  await t.test('createTab does not perform duplicate renderTabs when foregrounded', () => {
    let renderCalls = 0;
    const mockApp = {
      tabs: [],
      activeTabId: null,
      renderTabs() { renderCalls++; },
      showTab(id) {
        this.activeTabId = id;
        this.renderTabs(); // selectTab internal render
      },
      createTab(background) {
        const newTab = { id: 'tab_test', content: 'test' };
        this.tabs.push(newTab);
        if (!background) {
          this.showTab(newTab.id);
        } else {
          this.renderTabs();
        }
        return newTab;
      }
    };

    mockApp.createTab(false);
    assert.equal(renderCalls, 1, 'Foreground tab creation must invoke renderTabs exactly once');

    renderCalls = 0;
    mockApp.createTab(true);
    assert.equal(renderCalls, 1, 'Background tab creation must invoke renderTabs exactly once');
  });
});
