async function contrast(page, scope = 'body') {
  return page.evaluate(scope => {
    const parse = value => {
      const match = value.match(/^rgba?\(([^)]+)\)/);
      return match ? match[1].split(',').map(Number).concat(match[1].split(',').length === 3 ? [1] : []) : [0, 0, 0, 0];
    };
    const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])).concat(1);
    const luminance = rgb => rgb.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const failures = [];
    for (const el of document.querySelector(scope).querySelectorAll('*')) {
      const input = el.matches('input');
      const text = input ? el.value ? 'Entered input value' : el.placeholder : [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent.trim()).filter(Boolean).join(' ');
      if (!text || el.closest('svg, [inert], .faq-a[aria-hidden="true"], script, style') || !el.getClientRects().length) continue;
      const style = getComputedStyle(el, input && !el.value ? '::placeholder' : null);
      if (style.visibility === 'hidden' || parse(style.color)[3] === 0) continue;
      const chain = []; let opacity = 1;
      for (let node = el; node; node = node.parentElement) { chain.push(getComputedStyle(node)); opacity *= Number(getComputedStyle(node).opacity); }
      if (opacity < .05) continue;
      let backgrounds = [{color: [255, 255, 255, 1], layers: []}];
      for (const css of chain.reverse()) {
        backgrounds = backgrounds.map(bg => ({color: blend(parse(css.backgroundColor), bg.color), layers: [...bg.layers, {backdrop: bg.color, opacity: Number(css.opacity)}]}));
        if (css.backgroundImage.includes('gradient') && !css.backgroundClip.includes('text')) {
          const stops = css.backgroundImage.match(/rgba?\([^)]+\)/g) || [];
          if (stops.length) backgrounds = backgrounds.flatMap(bg => stops.map(stop => ({...bg, color: blend(parse(stop), bg.color)})));
        }
      }
      const color = parse(style.color);
      const actual = Math.min(...backgrounds.map(sample => {
        let fg = blend(color, sample.color), bg = sample.color;
        for (const layer of [...sample.layers].reverse()) {
          fg = blend(fg.slice(0, 3).concat(layer.opacity), layer.backdrop);
          bg = blend(bg.slice(0, 3).concat(layer.opacity), layer.backdrop);
        }
        return ratio(fg, bg);
      }));
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      const required = large ? 3 : 4.5;
      if (actual + .02 < required) failures.push({ selector: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''), text: text.slice(0, 70), ratio: +actual.toFixed(2), required, color: style.color });
    }
    return failures;
  }, scope);
}

module.exports = contrast;
