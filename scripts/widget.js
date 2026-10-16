// Tennis Home Screen widget for the Scriptable app (iOS). Setup: README, "Home Screen widget".
// Paste the line from Me > Home Screen widget when asked; it is kept in the iPhone Keychain, not in this file.
const KEY = 'tennis-widget';
const ground = new Color('#0e1411');
const text = new Color('#eef2ec');
const muted = new Color('#a3b0a8');
const accent = new Color('#d7f04b');

async function setup() {
  const alert = new Alert();
  alert.title = 'Tennis widget';
  alert.message = 'Paste the setup line from the app (Me > Home Screen widget).';
  alert.addTextField('https://… token https://…');
  alert.addAction('Save');
  alert.addCancelAction('Cancel');
  if ((await alert.present()) === -1) return null;
  Keychain.set(KEY, alert.textFieldValue(0).trim().replace(/\s+/g, ' '));
  return Keychain.get(KEY);
}

async function load(line) {
  const [url, token] = line.split(' '); // line: API address, token, app address
  const request = new Request(`${url}/widget`);
  request.headers = { 'X-Widget-Token': token };
  const data = await request.loadJSON();
  if (request.response.statusCode === 401) return null; // turned off, replaced or mis-pasted
  return data;
}

function when(next) {
  const start = new Date(next.start);
  const day = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return next.allDay ? day : `${day} · ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function trend(values, width, height) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i) => (i / Math.max(values.length - 1, 1)) * width;
  const y = (v) => height - 2 - ((v - lo) / Math.max(hi - lo, 0.01)) * (height - 4); // improving (lower) WTN plots lower
  const draw = new DrawContext();
  draw.size = new Size(width, height);
  draw.opaque = false;
  const path = new Path();
  values.forEach((v, i) => (i ? path.addLine(new Point(x(i), y(v))) : path.move(new Point(x(i), y(v)))));
  draw.addPath(path);
  draw.setStrokeColor(accent);
  draw.setLineWidth(2);
  draw.strokePath();
  return draw.getImage();
}

function label(stack, value, size, color, bold) {
  const t = stack.addText(value);
  t.textColor = color;
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.lineLimit = 1;
  return t;
}

function build(data, stale, site) {
  const w = new ListWidget();
  w.backgroundColor = ground;
  if (site) w.url = site; // tap opens the app
  const medium = config.widgetFamily === 'medium';
  const row = w.addStack();
  row.layoutHorizontally();
  const left = row.addStack();
  left.layoutVertically();
  label(left, 'WTN · DOUBLES', 10, muted, true);
  if (data.wtn) {
    const big = left.addStack();
    big.bottomAlignContent();
    label(big, Number(data.wtn.value).toFixed(2), 32, text, true);
    if (data.wtn.better) label(big, `  ${data.wtn.better > 0 ? '▼' : '▲'}${Math.abs(data.wtn.better).toFixed(2)}`, 12, accent, true);
    if (data.wtn.trend.length > 1) left.addImage(trend(data.wtn.trend.map(Number), 110, 28));
  }
  if (medium) row.addSpacer();
  const right = medium ? row.addStack() : left;
  right.layoutVertically();
  label(right, 'NEXT MATCH', 10, muted, true);
  label(right, data.next ? when(data.next) : 'No match scheduled', 13, text, true);
  if (data.next && medium) label(right, data.next.title, 12, muted, false);
  if (stale) label(w, `Updated ${stale}`, 9, muted, false);
  return w;
}

const cache = FileManager.local().joinPath(FileManager.local().documentsDirectory(), 'tennis-widget.json');
let line = Keychain.contains(KEY) ? Keychain.get(KEY) : await setup();
if (line) {
  const files = FileManager.local();
  let data;
  let stale = '';
  try {
    data = await load(line);
    if (!data) {
      Keychain.remove(KEY); // the next run asks for a new line
      files.remove(cache);
      const w = new ListWidget();
      w.backgroundColor = ground;
      label(w, 'Widget turned off. Run the script to set up again.', 12, text, true);
      if (config.runsInWidget) Script.setWidget(w);
      else await w.presentSmall();
      Script.complete();
      return;
    }
    files.writeString(cache, JSON.stringify({ at: Date.now(), data }));
  } catch (e) {
    if (!files.fileExists(cache)) throw e;
    const saved = JSON.parse(files.readString(cache));
    data = saved.data;
    const minutes = Math.round((Date.now() - saved.at) / 60000);
    stale = minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)}h ago`;
  }
  const widget = build(data, stale, line.split(' ')[2]);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}
