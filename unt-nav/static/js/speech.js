/* Voice guidance using the browser's built-in speech (Web Speech API). No server or
 * internet needed; works in Chrome/Edge on Windows and Android, and in Safari.
 *
 * Voice.supported      false if this browser can't speak
 * Voice.speak(text, {rate})  say text, cutting off anything already being said
 * Voice.stop()         stop talking
 * Voice.spoken(text)   how a direction is turned into speech ("ft." -> "feet" ...)
 */
(function () {
  "use strict";
  var synth = window.speechSynthesis;
  var supported = !!(synth && window.SpeechSynthesisUtterance);
  var voice = null, pending = null;

  function pickVoice() {
    if (!supported) return;
    var voices = synth.getVoices();
    if (!voices.length) return;
    var lang = (navigator.language || "en-US").toLowerCase();
    function score(v) {
      var l = (v.lang || "").toLowerCase().replace("_", "-");
      return (l === lang ? 4 : l.indexOf(lang.split("-")[0]) === 0 ? 2 : 0) + (v.localService ? 1 : 0);
    }
    voice = voices.slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }
  if (supported) {
    pickVoice();
    // Chrome loads its voice list after the page; pick again when it arrives.
    if ("onvoiceschanged" in synth) synth.addEventListener("voiceschanged", pickVoice);
  }

  /* Directions are written for reading; make them sound natural. */
  function spoken(text) {
    return text
      .replace(/(\d+) ft\./g, "$1 feet.")
      .replace(/\(([A-M]\d{3})\)/g, ", $1,")         // "main hallway (C136)" -> "main hallway, C136,"
      .replace(/\b([A-MC])(\d{3})([A-Z]?)\b/g, "$1 $2 $3")  // "B205" -> "B 205" (read as a room number)
      .replace(/\s+([,.])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function stop() {
    if (!supported) return;
    clearTimeout(pending);
    synth.cancel();
  }

  function speak(text, opts) {
    if (!supported || !text) return;
    stop();
    // Chrome drops an utterance queued in the same tick as cancel(); wait a moment.
    pending = setTimeout(function () {
      var u = new SpeechSynthesisUtterance(spoken(text));
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.rate = (opts && opts.rate) || 1;
      synth.speak(u);
      // Chrome can stay paused after the tab was in the background; nudge it.
      if (synth.paused) synth.resume();
    }, 80);
  }

  window.Voice = { supported: supported, speak: speak, stop: stop, spoken: spoken };
})();
