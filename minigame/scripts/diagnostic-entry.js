// ES5 loader intentionally stays separate: even a syntax error in app.js is caught.
// Only packaged by build.mjs --diagnose. No account, network or storage access.
(function () {
  var stage = 'entry';
  var failure = '';
  var shown = false;
  var complete = false;
  var trace = [];
  GameGlobal.__dkBootMark = function (next) {
    if (shown || complete) return;
    stage = next;
    trace.push(next);
    if (trace.length > 16) trace.shift();
    if (next === 'app-returned') complete = true;
  };
  function record(error) {
    var name = error && error.name;
    failure = /^(TypeError|ReferenceError|SyntaxError|RangeError)$/.test(name) ? name : 'Error';
    // Never show raw error messages: they may contain private application data.
  }
  function report() {
    if (shown) return;
    shown = true;
    var detail = 'D0910-1 / ' + stage + (failure ? ' / ' + failure : '') + '\n' + trace.join(' > ');
    console.info('[DK boot]', detail);
    wx.showModal({title: '启动诊断（非修复版）', content: detail, showCancel: false});
  }
  setTimeout(report, 5000);
  try {
    GameGlobal.__dkBootMark('loading-app');
    require('./app.js');
    GameGlobal.__dkBootMark('app-returned');
  } catch (error) {
    record(error);
    report();
  }
})();
