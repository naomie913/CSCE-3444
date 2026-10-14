
document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("[data-copy]");
  if (!btn) return;
  var input = document.getElementById(btn.getAttribute("data-copy"));
  if (!input) return;
  var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
  else { input.select(); document.execCommand("copy"); done(); }
});

document.addEventListener("submit", function (ev) {
  var msg = ev.target.getAttribute("data-confirm");
  if (msg && !window.confirm(msg)) ev.preventDefault();
});
