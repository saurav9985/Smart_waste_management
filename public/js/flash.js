(function () {
  var params = new URLSearchParams(window.location.search);
  if (params.get("posted") === "1") {
    var el = document.createElement("p");
    el.className = "flash flash-success";
    el.setAttribute("role", "status");
    el.textContent = "Thanks — your report was saved.";
    var form = document.querySelector(".report-form");
    if (form && form.parentNode) {
      form.parentNode.insertBefore(el, form);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }
  if (params.get("registered") === "1") {
    var submit = document.querySelector(".submit-panel");
    if (submit) {
      var reg = document.createElement("p");
      reg.className = "flash flash-success";
      reg.setAttribute("role", "status");
      reg.textContent = "Welcome — your citizen account is ready. You can submit a report below.";
      var h2s = submit.querySelector("h2");
      if (h2s && h2s.nextSibling) {
        submit.insertBefore(reg, h2s.nextSibling);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }
  if (params.get("resolved") === "1") {
    var list = document.querySelector(".list-panel");
    if (list) {
      var note = document.createElement("p");
      note.className = "flash flash-success";
      note.setAttribute("role", "status");
      note.textContent = "Status updated to resolved.";
      var h2 = list.querySelector("h2");
      if (h2 && h2.nextSibling) {
        list.insertBefore(note, h2.nextSibling);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }
  if (params.get("deleted") === "1") {
    var listDel = document.querySelector(".list-panel");
    if (listDel) {
      var delNote = document.createElement("p");
      delNote.className = "flash flash-success";
      delNote.setAttribute("role", "status");
      delNote.textContent = "Your complaint was removed.";
      var h2d = listDel.querySelector("h2");
      if (h2d && h2d.nextSibling) {
        listDel.insertBefore(delNote, h2d.nextSibling);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }
})();
