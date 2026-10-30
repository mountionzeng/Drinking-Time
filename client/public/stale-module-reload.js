// 从 index.html 内联脚本移出，满足 CSP script-src 'self'（不允许内联脚本）。
      (function () {
        var RELOAD_MARK = "dt:staleModuleReloaded";
        var reloaded = false;
        try {
          reloaded = sessionStorage.getItem(RELOAD_MARK) === "1";
        } catch (error) {
          reloaded = true; // 读不到就不自动刷，只提示，免得刷不停。
        }

        function rootIsEmpty() {
          var root = document.getElementById("root");
          return !root || root.childElementCount === 0;
        }

        function recover() {
          if (!rootIsEmpty()) return;
          if (reloaded) {
            console.error(
              "[启动失败] 页面脚本加载不起来，自动重载已经试过一次。请手动硬刷新（Cmd/Ctrl + Shift + R）。"
            );
            return;
          }
          try {
            sessionStorage.setItem(RELOAD_MARK, "1");
          } catch (error) {
            return;
          }
          console.warn("[启动失败] 检测到过期的脚本地址，正在自动重载…");
          location.reload();
        }

        // 模块脚本加载失败会冒泡到 window 的 error 事件（带 target）。
        window.addEventListener(
          "error",
          function (event) {
            var target = event.target;
            if (!target || target === window) return;
            var tag = target.tagName;
            if (tag !== "SCRIPT" && tag !== "LINK") return;
            setTimeout(recover, 0);
          },
          true
        );

        // 兜一层：脚本没报错但也没挂上（比如整块被 MIME 挡掉）。
        window.addEventListener("load", function () {
          setTimeout(recover, 2500);
        });

        // 正常起来了就把标记清掉，下次再坏还能自动救一次。
        window.addEventListener("load", function () {
          setTimeout(function () {
            if (rootIsEmpty()) return;
            try {
              sessionStorage.removeItem(RELOAD_MARK);
            } catch (error) {
              // 清不掉只影响下一次能不能自动重载，不影响本次。
            }
          }, 4000);
        });
      })();
