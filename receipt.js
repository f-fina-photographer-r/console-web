// Receipt images (1080x1920 PNG) drawn on receipt-base.png, laid out like the owner's Canva receipts.
// The layout functions are pure and run under node (tests/receipt.test.js); the page wiring at the
// bottom runs only in a browser. Positions are Canva design px measured on 2026-11-26; sizes are
// Canva pt (1 pt = 4/3 px).
(function () {
  "use strict";

  var PX = 4 / 3;
  var W = 1080;
  var BOX = { labelX: 136, valueX: 439, right: 944, top: 515, pitch: 213, bottom: 1650, gap: 48, footerY: 1711 };
  var STYLE = {
    label: { weight: 700, color: "#60503E", ratio: 31.6 / 26.7, minPt: 24 },
    value: { weight: 400, color: "#AF8655" },
    footer: { pt: 18, weight: 400, color: "#A4917B", spacing: 0.4 },
    spacing: 0.234,
    labelLineHeight: 1.38,
  };
  // Shrink the line height first, then the type, half a point at a time, before anything moves to a
  // new page. 20 pt is still readable on a phone; below that the owner should cut the text instead.
  var LINE_HEIGHTS = [1.38, 1.3, 1.22];
  var MAX_PT = 26.7;
  var MIN_PT = 20;
  var PAGE_ONE = ["拍攝時間", "當日會合", "拍攝時長", "被攝人數", "關於付款"];
  var PAGE_TWO = ["參考資訊", "挑照方式", "返照相關", "其他事項"];
  var CONTINUED = "（續）";

  // A line may not start with closing punctuation or end with opening punctuation; Latin words and
  // numbers ("570", "Fina", "10:30") stay whole unless one is wider than the whole column.
  var CLOSE = "，。、；：！？）」』》〉】〕﹞,.;:!?)]}%…～・‧";
  var OPEN = "（「『《〈【〔﹝([{";
  var UNIT = /[A-Za-z0-9]+(?:[.,:'’\-\/][A-Za-z0-9]+)*|[\s\S]/gu;
  var BLANK = /^\s+$/;

  function sizes() {
    var list = [];
    for (var pt = MAX_PT; pt >= MIN_PT - 1e-9; pt = pt === MAX_PT ? Math.floor(pt * 2) / 2 : pt - 0.5) {
      list.push(Math.round(pt * 10) / 10);
    }
    return list;
  }

  // measure(ch) is a character's advance in px without letter spacing; sp is the spacing in px.
  function unitWidth(unit, measure, sp) {
    return Array.from(unit).reduce(function (sum, ch) { return sum + measure(ch) + sp; }, 0);
  }

  function lineWidth(units, measure, sp) {
    var w = units.reduce(function (sum, u) { return sum + unitWidth(u, measure, sp); }, 0);
    return units.length ? w - sp : 0;  // no spacing after the last character
  }

  function wrap(text, width, measure, sp) {
    var out = [];
    String(text).replace(/\r/g, "").split("\n").forEach(function (para) {
      var units = para.match(UNIT) || [];
      var line = [];
      var flush = function () {
        while (line.length && BLANK.test(line[line.length - 1])) line.pop();
        out.push(line.join(""));
        line = [];
      };
      for (var i = 0; i < units.length; i++) {
        var u = units[i];
        if (!line.length && BLANK.test(u)) continue;
        if (lineWidth(line.concat([u]), measure, sp) <= width) { line.push(u); continue; }
        var chars = Array.from(u);
        if (!line.length) {
          if (chars.length > 1) { units = units.slice(0, i).concat(chars, units.slice(i + 1)); i--; continue; }
          line.push(u);  // a single character wider than the column: nothing better to do
          continue;
        }
        var carry = [];
        if (CLOSE.indexOf(chars[0]) >= 0 && line.length > 1) carry.unshift(line.pop());
        while (line.length > 1 && OPEN.indexOf(line[line.length - 1]) >= 0) carry.unshift(line.pop());
        flush();
        line = carry.concat([u]);
      }
      flush();
    });
    while (out.length && out[out.length - 1] === "") out.pop();
    return out;
  }

  function sizeOf(pt, lineHeight) {
    var value = pt * PX;
    var label = Math.max(STYLE.label.minPt, pt * STYLE.label.ratio) * PX;
    return {
      pt: pt, lineHeight: lineHeight, value: value, label: label,
      line: value * lineHeight, labelLine: label * STYLE.labelLineHeight,
      valueSp: value * STYLE.spacing, labelSp: label * STYLE.spacing,
    };
  }

  // fields: [{label, text}]. measure(ch, px, weight) gives a character's advance at that size.
  // With paged false, returns null when the fields do not fit one page; with paged true, rows that do not
  // fit continue on further pages ("（續）" after the label).
  function place(fields, size, measure, paged) {
    var width = BOX.right - BOX.valueX;
    var valueMeasure = function (ch) { return measure(ch, size.value, STYLE.value.weight); };
    var pages = [[]];
    var slot = 0;
    var prevBottom = null;
    var queue = fields.filter(function (f) { return String(f.text || "").trim(); }).map(function (f) {
      return { label: f.label, lines: wrap(f.text, width, valueMeasure, size.valueSp) };
    });
    while (queue.length) {
      var f = queue.shift();
      var top = prevBottom === null ? BOX.top : Math.max(BOX.top + slot * BOX.pitch, prevBottom + BOX.gap);
      var room = Math.floor((BOX.bottom - top) / size.line);
      var needs = Math.max(size.labelLine, f.lines.length * size.line);
      if (top + needs <= BOX.bottom) {
        pages[pages.length - 1].push({ label: f.label, lines: f.lines, top: top });
        prevBottom = top + needs;
        slot++;
        continue;
      }
      if (!paged) return null;
      if (room >= 2) {  // split the row; a lone line left behind reads like a mistake, so need two
        pages[pages.length - 1].push({ label: f.label, lines: f.lines.slice(0, room), top: top });
        queue.unshift({ label: f.label.replace(CONTINUED, "") + CONTINUED, lines: f.lines.slice(room) });
      } else if (pages[pages.length - 1].length === 0) {
        return null;  // cannot even start on an empty page (cannot happen at these sizes)
      } else {
        queue.unshift(f);
      }
      pages.push([]);
      slot = 0;
      prevBottom = null;
    }
    return { size: size, pages: pages };
  }

  // The largest size at which the fields fit one page; failing that, the smallest size spread over pages.
  function fit(fields, measure) {
    var list = sizes();
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < LINE_HEIGHTS.length; j++) {
        var done = place(fields, sizeOf(list[i], LINE_HEIGHTS[j]), measure, false);
        if (done) return done;
      }
    }
    return place(fields, sizeOf(MIN_PT, LINE_HEIGHTS[LINE_HEIGHTS.length - 1]), measure, true);
  }

  function amount(text) {
    var t = String(text || "").replace(/[,，\s]/g, "").replace(/[０-９]/g, function (d) {
      return String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 48);
    });
    return /^\d+$/.test(t) ? Number(t) : null;
  }

  function headcount(text) {
    var m = String(text || "").replace(/[０-９]/g, function (d) {
      return String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 48);
    }).match(/\d+/);
    return m ? Number(m[0]) : null;
  }

  // items: [{name, amount}] where amount is a number or words ("互惠"). Returns the 關於付款 text and
  // problems to show before the owner sends anything.
  function payment(items, opts) {
    opts = opts || {};
    var lines = [];
    var errors = [];
    var numbers = [];
    items.forEach(function (it) {
      var name = String(it.name || "").trim();
      var raw = String(it.amount || "").trim();
      if (!name && !raw) return;
      if (!name || !raw) { errors.push("付款有一列只填了一半：" + (name || raw)); return; }
      var n = amount(raw);
      if (n !== null) numbers.push(n);
      lines.push(name + "｜" + (n !== null ? String(n) : raw));
    });
    var total = numbers.reduce(function (a, b) { return a + b; }, 0);
    if (numbers.length > 1) lines.push("合計｜" + total);
    if (opts.split) {
      var people = headcount(opts.people);
      if (!numbers.length) errors.push("要均攤，但付款沒有數字金額");
      else if (!people || people < 2) errors.push("要均攤，但被攝人數沒有寫 2 以上的數字");
      else {
        var each = Math.ceil(total / people);
        lines.push(total + "÷" + people + "=" + (total / people === each ? each : (total / people).toFixed(1))
          + "　每人均攤" + each);
        if (total % people) errors.push("合計 " + total + " 除以 " + people + " 人除不盡，每人寫成 " + each + "（無條件進位），請確認");
      }
    }
    if (String(opts.note || "").trim()) lines.push(String(opts.note).trim());
    return { text: lines.join("\n"), total: total, errors: errors };
  }

  function footer(client, date) {
    var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
    var when = d ? Number(d[1]) + "." + Number(d[2]) + "." + Number(d[3]) : "";
    return "Fina　｜　" + when + "　｜　" + String(client || "").trim();
  }

  function missingChars(text, charset) {
    var have = new Set(Array.from(charset));
    var seen = new Set();
    Array.from(String(text)).forEach(function (ch) {
      if (!BLANK.test(ch) && !have.has(ch)) seen.add(ch);
    });
    return Array.from(seen);
  }

  // Both pages from the form's values. Returns {pages: [{size, rows}], footer, errors, warnings}.
  function build(values, measure, charset) {
    var errors = [];
    var warnings = [];
    var pay = payment(values.items || [], { split: values.split, people: values["被攝人數"], note: values["付款補充"] });
    errors = errors.concat(pay.errors);
    var first = PAGE_ONE.map(function (k) { return { label: k, text: k === "關於付款" ? pay.text : values[k] }; });
    var second = PAGE_TWO.map(function (k) { return { label: k, text: values[k] }; });
    var one = fit(first, measure);
    if (!one || one.pages.length > 1) {
      errors.push("第一頁縮到 " + MIN_PT + " pt 仍放不下：把較長的說明移到第二頁的「其他事項」");
    }
    var two = fit(second, measure);
    if (!two) errors.push("第二頁排不下（單一列太長），請分段");
    if (!String(values.client || "").trim()) errors.push("請填客人名（頁尾）");
    var foot = footer(values.client, values.date);
    var all = first.concat(second).map(function (f) { return f.text || ""; }).join("") + foot;
    var missing = charset ? missingChars(all, charset) : [];
    if (missing.length) warnings.push("這些字不在收據字型裡，會用系統字型畫出、字形可能不同：" + missing.join(" "));
    if (two && two.pages.length > 1) warnings.push("第二頁縮到 " + MIN_PT + " pt 仍放不下，接到第 3 頁之後");
    [one, two].forEach(function (r, i) {
      if (r && r.size.pt < MAX_PT) warnings.push("第" + (i ? "二" : "一") + "頁字級自動縮為 " + r.size.pt + " pt");
    });
    var pages = [];
    [one, two].forEach(function (r) {
      if (r) r.pages.forEach(function (rows) { if (rows.length) pages.push({ size: r.size, rows: rows }); });
    });
    return { pages: pages, footer: foot, errors: errors, warnings: warnings };
  }

  var api = {
    BOX: BOX, STYLE: STYLE, MIN_PT: MIN_PT, MAX_PT: MAX_PT, sizes: sizes, wrap: wrap, lineWidth: lineWidth,
    place: place, fit: fit, sizeOf: sizeOf, payment: payment, footer: footer, missingChars: missingChars, build: build,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof document === "undefined") return;

  // ---- Browser ----
  var FAMILY = '"ReceiptSerif", "Noto Serif TC", serif';
  var scratch = document.createElement("canvas").getContext("2d");
  var widths = new Map();

  function measure(ch, px, weight) {
    var key = weight + "|" + px + "|" + ch;
    if (!widths.has(key)) {
      scratch.font = weight + " " + px + "px " + FAMILY;
      widths.set(key, scratch.measureText(ch).width);
    }
    return widths.get(key);
  }

  // Character by character, so the spacing and the line breaks are exactly the ones measured above.
  function drawSpaced(ctx, text, x, mid, px, weight, sp) {
    ctx.font = weight + " " + px + "px " + FAMILY;
    Array.from(text).forEach(function (ch) {
      ctx.fillText(ch, x, mid);
      x += measure(ch, px, weight) + sp;
    });
  }

  function render(base, page, foot) {
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = 1920;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(base, 0, 0, W, 1920);
    ctx.textBaseline = "middle";
    var s = page.size;
    page.rows.forEach(function (row) {
      var mid = row.top + s.line / 2;  // the label sits on the value's first line
      ctx.fillStyle = STYLE.label.color;
      drawSpaced(ctx, row.label, BOX.labelX, mid, s.label, STYLE.label.weight, s.labelSp);
      ctx.fillStyle = STYLE.value.color;
      row.lines.forEach(function (line, i) {
        drawSpaced(ctx, line, BOX.valueX, mid + i * s.line, s.value, STYLE.value.weight, s.valueSp);
      });
    });
    var fpx = STYLE.footer.pt * PX;
    var fsp = fpx * STYLE.footer.spacing;
    var fw = lineWidth(Array.from(foot), function (ch) { return measure(ch, fpx, STYLE.footer.weight); }, fsp);
    ctx.fillStyle = STYLE.footer.color;
    drawSpaced(ctx, foot, (W - fw) / 2, BOX.footerY, fpx, STYLE.footer.weight, fsp);
    return canvas;
  }

  var form = document.getElementById("form");
  var items = document.getElementById("items");
  var messages = document.getElementById("messages");
  var output = document.getElementById("output");
  var urls = [];

  function addItem(name, value) {
    var row = document.createElement("div");
    row.className = "row";
    var n = document.createElement("input");
    n.placeholder = "項目，例：委託款項";
    n.value = name || "";
    n.className = "item-name";
    var a = document.createElement("input");
    a.placeholder = "金額或互惠";
    a.value = value || "";
    a.className = "item-amount";
    var del = document.createElement("button");
    del.type = "button";
    del.textContent = "刪除";
    del.addEventListener("click", function () { row.remove(); });
    row.append(n, a, del);
    items.append(row);
  }

  function say(list, cls) {
    list.forEach(function (text) {
      var p = document.createElement("p");
      p.className = cls;
      p.textContent = text;
      messages.append(p);
    });
  }

  function values() {
    var data = new FormData(form);
    var v = {};
    data.forEach(function (val, key) { v[key] = val; });
    v.split = data.has("split");
    v.items = Array.from(items.querySelectorAll(".row")).map(function (r) {
      return { name: r.querySelector(".item-name").value, amount: r.querySelector(".item-amount").value };
    });
    return v;
  }

  var baseImage = new Image();
  var baseReady = new Promise(function (ok, fail) { baseImage.onload = ok; baseImage.onerror = fail; });
  baseImage.src = "receipt-base.png";

  async function generate(event) {
    event.preventDefault();
    messages.textContent = "";
    output.textContent = "";
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    await Promise.all([baseReady, document.fonts.load("400 36px ReceiptSerif", "收"), document.fonts.load("700 36px ReceiptSerif", "收")]);
    widths.clear();
    var v = values();
    var result = build(v, measure, typeof RECEIPT_CHARS === "string" ? RECEIPT_CHARS : "");
    say(result.errors, "error");
    say(result.warnings, "warn");
    if (result.errors.length) return;  // a receipt with a wrong sum or a cut-off page must not go out
    var stamp = String(v.date || "").replace(/-/g, "");
    for (var i = 0; i < result.pages.length; i++) {
      var canvas = render(baseImage, result.pages[i], result.footer);
      var blob = await new Promise(function (ok) { canvas.toBlob(ok, "image/png"); });
      var url = URL.createObjectURL(blob);
      urls.push(url);
      var fig = document.createElement("figure");
      var img = document.createElement("img");
      img.src = url;
      img.alt = "收據第 " + (i + 1) + " 頁";
      var link = document.createElement("a");
      link.href = url;
      link.download = "收據_" + stamp + "_" + String(v.client).trim() + "_" + (i + 1) + ".png";
      link.textContent = "下載第 " + (i + 1) + " 頁";
      var cap = document.createElement("figcaption");
      cap.append(link);
      fig.append(img, cap);
      output.append(fig);
    }
  }

  ["委託款項", "車馬費"].forEach(function (n) { addItem(n, ""); });
  document.getElementById("add").addEventListener("click", function () { addItem("", ""); });
  var today = new Date();
  form.elements.date.value = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0")
    + "-" + String(today.getDate()).padStart(2, "0");
  form.addEventListener("submit", function (e) {
    generate(e).catch(function (err) { say(["產生失敗：" + (err && err.message || err)], "error"); });
  });
})();
