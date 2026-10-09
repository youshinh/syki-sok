import base64
import urllib.request
import xml.etree.ElementTree as ET

# Load syki app icon
with open('app.png', 'rb') as f:
    b64_icon = base64.b64encode(f.read()).decode('ascii')

# Fetch Geist Sans Medium
url_sans = 'https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/Geist-Medium.woff2'
req_sans = urllib.request.Request(url_sans, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req_sans) as resp:
    b64_geist_sans = base64.b64encode(resp.read()).decode('ascii')

# Fetch Geist Mono Regular
url_mono = 'https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/GeistMono-Regular.woff2'
req_mono = urllib.request.Request(url_mono, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req_mono) as resp:
    b64_geist_mono = base64.b64encode(resp.read()).decode('ascii')

primitives = [
    ("AI AT CURSOR", "Ctrl+L"),
    ("GHOST-TEXT", "Tab"),
    ("VOICE DICTATION", "Ctrl+Shift+R"),
    ("VISION &amp; OCR", "Ctrl+Shift+U"),
    ("AGENT DISPATCH", "Ctrl+Enter"),
    ("SHELL PIPE", "Ctrl+E"),
    ("INSTANT SUMMON", "Ctrl+Alt+M"),
    ("HEADLESS API", "stdin / rpc"),
]

rows_svg = []
y_start = 145
row_height = 36

for i, (action, key) in enumerate(primitives):
    y = y_start + i * row_height
    rows_svg.append(f"""    <g transform="translate(0, {y})">
      <text x="0" y="0" class="sans-action">{action}</text>
      <text x="360" y="0" text-anchor="end" class="mono-key">{key}</text>
      <line x1="0" y1="12" x2="360" y2="12" stroke="#141417" stroke-width="0.8"/>
    </g>""")

rows_str = "\n".join(rows_svg)

svg_content = f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 960 540" width="100%" height="100%">
  <defs>
    <style>
      @font-face {{
        font-family: 'Geist';
        src: url('data:font/woff2;base64,{b64_geist_sans}') format('woff2');
        font-weight: 500;
        font-style: normal;
      }}
      @font-face {{
        font-family: 'Geist Mono';
        src: url('data:font/woff2;base64,{b64_geist_mono}') format('woff2');
        font-weight: 400;
        font-style: normal;
      }}

      .sans-title {{
        font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
        font-size: 9px;
        font-weight: 500;
        letter-spacing: 0.26em;
        fill: #52525b;
        text-transform: uppercase;
      }}
      .sans-action {{
        font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
        font-size: 10px;
        font-weight: 500;
        fill: #a1a1aa;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }}
      .mono-key {{
        font-family: 'Geist Mono', 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace;
        font-size: 9.5px;
        font-weight: 400;
        fill: #52525b;
        letter-spacing: 0.05em;
      }}
      .mono-foot {{
        font-family: 'Geist Mono', 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace;
        font-size: 8.5px;
        font-weight: 400;
        letter-spacing: 0.18em;
        fill: #3f3f46;
        text-transform: uppercase;
      }}
    </style>
  </defs>

  <!-- Canvas: 墨色 (Deep Matte Sumiiro #09090b) -->
  <rect width="960" height="540" fill="#09090b"/>

  <!-- Minimal Hairline Outer Frame -->
  <rect x="0.5" y="0.5" width="959" height="539" fill="none" stroke="#18181b" stroke-width="1"/>

  <!-- Subtle Center Hairline Divider -->
  <line x1="480" y1="50" x2="480" y2="490" stroke="#131316" stroke-width="1"/>

  <!-- ================= LEFT PANEL : ICON & BREATHTAKING NEGATIVE SPACE ================= -->
  <text x="64" y="76" class="sans-title">SYKI::SOK</text>

  <!-- App Icon: Scaled to 175px to allow maximum surrounding negative space -->
  <g transform="translate(152, 170)">
    <image width="175" height="175" xlink:href="data:image/png;base64,{b64_icon}"/>
  </g>

  <!-- Left Bottom Meta -->
  <text x="64" y="482" class="mono-foot">NATIVE WEBVIEW · GO CORE</text>
  <text x="416" y="482" text-anchor="end" class="mono-foot">&lt; 15 MS WAKE</text>


  <!-- ================= RIGHT PANEL : DISCIPLINED REFINED PRIMITIVES ================= -->
  <text x="536" y="76" class="sans-title">PRIMITIVES</text>

  <!-- Generously Spaced Typographic Grid (Geist + Geist Mono) -->
  <g transform="translate(536, 0)">
{rows_str}
  </g>

  <!-- Right Bottom Meta -->
  <text x="536" y="482" class="mono-foot">AGENT-READY SURFACE</text>
  <text x="896" y="482" text-anchor="end" class="mono-foot">PLAIN LOCAL .MD</text>
</svg>"""

with open('img/poster_minimal.svg', 'w', encoding='utf-8') as f:
    f.write(svg_content)

ET.parse('img/poster_minimal.svg')
print("Successfully generated poster with embedded Geist & Geist Mono fonts!")
