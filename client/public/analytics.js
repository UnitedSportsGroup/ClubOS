(function() {
  var ENDPOINT = '/api/public/analytics/event';
  var BATCH_ENDPOINT = '/api/public/analytics/batch';

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getVisitorId() {
    var id = localStorage.getItem('_cufc_vid');
    if (!id) { id = uuid(); localStorage.setItem('_cufc_vid', id); }
    return id;
  }

  function getSessionId() {
    var id = sessionStorage.getItem('_cufc_sid');
    if (!id) { id = uuid(); sessionStorage.setItem('_cufc_sid', id); }
    return id;
  }

  function getDevice() {
    var w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function getBrowser() {
    var ua = navigator.userAgent;
    if (ua.indexOf('Chrome') > -1 && ua.indexOf('Edg') === -1) return 'Chrome';
    if (ua.indexOf('Safari') > -1 && ua.indexOf('Chrome') === -1) return 'Safari';
    if (ua.indexOf('Firefox') > -1) return 'Firefox';
    if (ua.indexOf('Edg') > -1) return 'Edge';
    return 'Other';
  }

  function getUTM() {
    var params = new URLSearchParams(window.location.search);
    return {
      utmSource: params.get('utm_source') || null,
      utmMedium: params.get('utm_medium') || null,
      utmCampaign: params.get('utm_campaign') || null
    };
  }

  function getCampSlug() {
    var path = window.location.pathname;
    if (path === '/' || path.startsWith('/admin') || path.startsWith('/login') || path.startsWith('/api')) return null;
    var parts = path.split('/').filter(Boolean);
    var skipPaths = ['login', 'admin', 'api', 'auth', 'settings', 'register'];
    if (parts.length >= 1 && skipPaths.indexOf(parts[0]) === -1) return parts[0];
    return null;
  }

  function getTrafficSource() {
    var utm = getUTM();
    if (utm.utmSource) {
      if (utm.utmSource.toLowerCase().indexOf('facebook') > -1 || utm.utmSource.toLowerCase().indexOf('meta') > -1 || utm.utmSource.toLowerCase().indexOf('instagram') > -1) return 'Meta Ads';
      if (utm.utmSource.toLowerCase().indexOf('google') > -1) return 'Google Ads';
      return utm.utmSource;
    }
    var ref = document.referrer;
    if (!ref) return 'Direct';
    if (ref.indexOf('facebook.com') > -1 || ref.indexOf('instagram.com') > -1) return 'Meta Organic';
    if (ref.indexOf('google.') > -1) return 'Organic Search';
    if (ref.indexOf('bing.') > -1) return 'Organic Search';
    if (ref.indexOf(window.location.hostname) > -1) return 'Internal';
    return 'Referral';
  }

  var visitorId = getVisitorId();
  var sessionId = getSessionId();
  var utm = getUTM();
  var isNewSession = !sessionStorage.getItem('_cufc_session_started');
  var pageLoadTime = Date.now();
  var maxScroll = 0;
  var hasInteracted = false;
  var eventQueue = [];
  var flushTimer = null;

  function queueEvent(eventType, metadata) {
    var evt = {
      visitorId: visitorId,
      sessionId: sessionId,
      eventType: eventType,
      page: window.location.pathname,
      referrer: document.referrer || null,
      utmSource: utm.utmSource,
      utmMedium: utm.utmMedium,
      utmCampaign: utm.utmCampaign,
      device: getDevice(),
      browser: getBrowser(),
      screenWidth: window.innerWidth,
      campSlug: getCampSlug(),
      metadata: metadata || null
    };
    eventQueue.push(evt);
    if (!flushTimer) {
      flushTimer = setTimeout(flushEvents, 2000);
    }
  }

  function flushEvents() {
    flushTimer = null;
    if (eventQueue.length === 0) return;
    var events = eventQueue.splice(0, eventQueue.length);
    try {
      var payload = JSON.stringify({ events: events });
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(BATCH_ENDPOINT, blob);
      } else {
        fetch(BATCH_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
      }
    } catch(e) {}
  }

  if (isNewSession) {
    sessionStorage.setItem('_cufc_session_started', '1');
    queueEvent('session_start', { trafficSource: getTrafficSource(), isNewVisitor: !localStorage.getItem('_cufc_returning') });
    localStorage.setItem('_cufc_returning', '1');
  }

  queueEvent('page_view', { trafficSource: getTrafficSource() });

  var lastPath = window.location.pathname;
  setInterval(function() {
    var currentPath = window.location.pathname;
    if (currentPath !== lastPath) {
      lastPath = currentPath;
      var slug = getCampSlug();
      if (slug) {
        queueEvent('page_view', { trafficSource: getTrafficSource() });
      }
    }
  }, 1000);

  window.addEventListener('scroll', function() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
    if (docHeight > 0) {
      var pct = Math.round((scrollTop / docHeight) * 100);
      if (pct > maxScroll) maxScroll = pct;
    }
    hasInteracted = true;
  }, { passive: true });

  document.addEventListener('click', function(e) {
    hasInteracted = true;
    var target = e.target;
    var el = target.closest ? target.closest('a, button, [data-testid]') : target;
    if (!el) return;
    var testid = el.getAttribute('data-testid') || '';
    var text = (el.textContent || '').trim().substring(0, 80);
    var tag = el.tagName.toLowerCase();
    var href = el.getAttribute('href') || '';

    if (testid.indexOf('cta') > -1 || testid.indexOf('register') > -1 || testid.indexOf('book') > -1 ||
        text.toLowerCase().indexOf('register') > -1 || text.toLowerCase().indexOf('book now') > -1 ||
        text.toLowerCase().indexOf('enrol') > -1 || text.toLowerCase().indexOf('sign up') > -1 ||
        (href && href.indexOf('/book') > -1)) {
      queueEvent('cta_click', { element: tag, testid: testid, text: text, href: href, x: e.clientX, y: e.clientY });
    }

    queueEvent('click', { element: tag, testid: testid, text: text, href: href, x: e.clientX, y: e.clientY, scrollY: window.pageYOffset });
  });

  window._cufc_track = function(eventType, metadata) {
    queueEvent(eventType, metadata);
  };

  function sendExitEvents() {
    var timeOnPage = Math.round((Date.now() - pageLoadTime) / 1000);
    queueEvent('time_on_page', { seconds: timeOnPage });
    queueEvent('scroll_depth', { maxPercent: maxScroll });
    if (!hasInteracted && timeOnPage < 10) {
      queueEvent('bounce', {});
    }
    flushEvents();
  }

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') sendExitEvents();
  });
  window.addEventListener('beforeunload', sendExitEvents);

  if (window.location.pathname.indexOf('/book') > -1) {
    queueEvent('form_view', {});
    var observer = new MutationObserver(function() {
      var steps = document.querySelectorAll('[data-step]');
      if (steps.length > 0) {
        steps.forEach(function(s) {
          if (!s._tracked) {
            s._tracked = true;
            var step = s.getAttribute('data-step');
            queueEvent('form_step', { step: step });
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
