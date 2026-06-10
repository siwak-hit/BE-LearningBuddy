function requestJson(url, options) {
  return fetch(url, options).then(function (res) {
    return res.json();
  });
}

function getWidgetConfig() {
  return requestJson(apiBase + '/api/widget/config/' + encodeURIComponent(projectKey) + '?t=' + Date.now(), {
    cache: 'no-store'
  });
}

function createChatSession() {
  return requestJson(apiBase + '/api/chat/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectKey: projectKey,
      sourceUrl: window.location.href,
      pageContext: getPageContext()
    })
  });
}

function getChatState() {
  return requestJson(apiBase + '/api/chat/state/' + encodeURIComponent(sessionId));
}

function getChatHistory() {
  return requestJson(apiBase + '/api/chat/history/' + encodeURIComponent(sessionId));
}

function getAiUsage() {
  return requestJson(apiBase + '/api/chat/ai-usage/' + encodeURIComponent(sessionId));
}

function unlockChat(key) {
  return requestJson(apiBase + '/api/chat/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sessionId, key: key })
  });
}

function sendChatMessage(message, elementContext) {
  return requestJson(apiBase + '/api/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: sessionId,
      message: message,
      pageContext: getPageContext(),
      elementContext: elementContext
    })
  });
}

function getSuggestions(trigger) {
  var pType = currentPageType || 'beranda';
  var url =
    apiBase +
    '/api/chat/suggestions?projectKey=' +
    encodeURIComponent(projectKey) +
    '&pageType=' +
    encodeURIComponent(pType) +
    '&trigger=' +
    encodeURIComponent(trigger);

  return requestJson(url);
}
