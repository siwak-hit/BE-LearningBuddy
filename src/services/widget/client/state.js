var currentScript = document.currentScript;
var scriptSrc = currentScript ? currentScript.src : '';
var scriptUrl = new URL(scriptSrc || window.location.href);

var apiBase = currentScript?.dataset?.apiBase || scriptUrl.origin;
var projectKey = currentScript?.dataset?.projectKey || scriptUrl.searchParams.get('projectKey');

if (!projectKey) {
  console.error('[AI Learning Buddy] projectKey tidak ditemukan');
  return;
}

var widgetId = 'ai-learning-buddy-widget';
var storageKey = 'alb_session_' + projectKey;
var lockCacheKey = 'alb_locked_' + projectKey;

var sessionId = sessionStorage.getItem(storageKey);
var isLocked = sessionStorage.getItem(lockCacheKey) === 'true';
var isRequesting = false;
var hasTypedWelcome = false;
var messageCount = 0;

var currentMode = 'floating';
var currentPageType = null;
var isConfirming = false;
var suggestionTimer = null;

var usageData = {
  max: 3,
  used: 0,
  cooldown_remaining_seconds: 0,
  cooldown_active: false
};
var cooldownInterval = null;

var isPickingMode = false;
var hoveredElement = null;
var activeElementContext = null;
var capsuleTimer = null;

var chatBoxNode = null;
var buttonNode = null;
var overlayNode = null;
var capsuleNode = null;
var inputNode = null;
var sendBtnNode = null;
var magicBtnNode = null;
var usageNode = null;
var bodyNode = null;

var contextContainerNode = null;
var contextLabelNode = null;
var contextClearNode = null;
