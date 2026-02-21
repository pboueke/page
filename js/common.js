// Update theme-color meta tag to match the current color scheme
(function () {
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;

  var mq = window.matchMedia("(prefers-color-scheme: dark)");

  function update() {
    meta.setAttribute("content", mq.matches ? "#111111" : "#ffffff");
  }

  mq.addEventListener("change", update);
  update();
})();
