// Infographic style prompts and prompt generation from Mermaid diagrams.
(function (global) {
  'use strict';

  function getInfographicStylePrompt(styleName) {
    const s = styleName || 'material';
    switch (s) {
      case 'sketchy':
        return "Hand-drawn whiteboard and marker sketch infographic design system. " +
          "Whiteboard surface background (off-white slate), marker pen line art with subtle organic hand-drawn wobble, friendly casual brainstorming aesthetic. " +
          "Content containers resemble light pastel sticky-notes with gentle 8px rounded corners (pale yellow, soft mint, light sky, pure white). " +
          "Focal accent is a single bright marker highlight (Coral Red) on 1 or 2 key nodes only; secondary elements use neutral dark slate pen strokes. " +
          "Connectors are clean orthogonal or gentle hand-drawn right-angle elbow arrows, never chaotic crossed lines. " +
          "Typography is friendly, highly legible Japanese hand-lettering or clean rounded sans (Noto Sans JP / Casual Sans). " +
          "Strictly NO 3D effects, NO drop shadows, NO photorealism, NO glossy gradients.";
      case 'editorial':
        return "Minimal editorial architectural design system (Swiss style publication aesthetic). " +
          "Warm off-white paper canvas, crisp jet-black hairline borders (1px), and generous architectural whitespace. " +
          "Focal accent is exactly ONE vibrant Tangerine / Coral accent reserved strictly for the 1 or 2 hero nodes; everything else is quiet ink and muted gray. " +
          "Connectors MUST be strictly orthogonal right-angle elbows (r=8px rounded corners); absolutely NO diagonal lines or crossed lines. " +
          "Typography uses an elegant editorial serif title with crisp geometric sans-serif node names (Noto Sans JP). " +
          "Strictly flat 2D, NO shadows, NO gradients, NO illustrations.";
      case 'terminal':
        return "Developer terminal and modern dark CLI window infographic design system. " +
          "Deep charcoal/black console background, crisp 1px dark slate borders, with a subtle top macOS-style window header bar with small colored dots (red, yellow, green). " +
          "Node containers are dark elevated blocks with 6px rounded corners. " +
          "Focal accent uses vibrant Emerald Green or Cyan on 1 or 2 critical nodes/links only. " +
          "Connectors are sharp orthogonal terminal routing lines with crisp arrowheads. " +
          "Typography uses monospace styling for endpoints, commands, and sublabels, with clean Noto Sans JP for primary labels. " +
          "Strictly clean developer UI, NO photorealism, NO 3D, NO muddy neon glows.";
      case 'ink':
        return "Japanese Wa-Modern sumi-ink minimalist infographic design system. " +
          "Textured pale washi paper background, deep sumi-ink black clean lines and typography, serene spatial harmony and generous breathing space (Ma). " +
          "Focal accent is a single traditional Japanese vermilion seal mark / cinnabar red accent on 1 key focal point; all other elements remain pure monochrome ink. " +
          "Connectors are precise, serene orthogonal right-angle lines with subtle brush-stroke termination. " +
          "Typography is refined, balanced Japanese Noto Sans JP / Mincho hybrid. " +
          "Calm, dignified, contemplative 2D technical aesthetic. NO glossy gradients, NO shadows.";
      case 'material':
      default:
        return "Material Design 3 infographic design system. " +
          "Flat solid colors only — absolutely NO gradients anywhere. " +
          "Page canvas is a slightly blue-tinted light grey; content sits on pure white cards with a 28px corner radius, a 1px light grey border and NO drop shadow. " +
          "Primary accent is Action Blue, used sparingly on ONLY the 1 or 2 most important hero nodes; supporting elements use neutral white or soft tonal blue container tint. " +
          "Connectors MUST be strictly orthogonal right-angle elbows with rounded corners; NO diagonal lines. " +
          "Action-like elements are full pill shapes; inputs 4px radius. " +
          "Typography is a clean geometric sans (Noto Sans JP / Roboto): headings are LARGE at normal-to-medium weight. " +
          "Icons are Google Material Symbols Outlined line icons, 24px, monochrome. " +
          "Strict 8px spacing grid, generous structural spacing, left-aligned layout, calm corporate aesthetic.";
    }
  }

  const CLEAN_INFOGRAPHIC_STYLE = getInfographicStylePrompt('material');

  const CLEAN_INFOGRAPHIC_NEGATIVES = 
    "No gradients of any kind. No drop shadows on cards. No heavy bold headings. " +
    "No emoji, no Unicode-symbol icons, no filled/colored icon badges. " +
    "No photography, no photorealism, no 3D, no glossy or glassy effects. " +
    "No hand-drawn or sketchy style. No neon, no dark cyberpunk. No decorative illustration. " +
    "No gibberish text. No random placeholder words. No blurry text. No tiny unreadable text. " +
    "Do NOT render any prompt meta labels such as: REFERENCE, DIAGRAM FIDELITY, TEXT FIDELITY, NEGATIVE CONSTRAINTS. " +
    "Do NOT render the instruction text of this prompt. Render only content derived from the Mermaid diagram.";

  function extractFlowDirectionText(code) {
    const src = String(code == null ? '' : code).replace(/\r/g, '');
    const first = src.split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
    const flow = /^(?:flowchart|graph)\s+([A-Za-z]{2})\b/i.exec(first);
    if (flow && flow[1]) {
      const dir = flow[1].toUpperCase();
      switch (dir) {
        case 'LR': return 'from left to right';
        case 'RL': return 'from right to left';
        case 'TB':
        case 'TD': return 'from top to bottom';
        case 'BT': return 'from bottom to top';
      }
    }
    const stateDir = /(?:^|\n)\s*direction\s+([A-Za-z]{2})\b/i.exec(src);
    if (stateDir && stateDir[1]) {
      const dir = stateDir[1].toUpperCase();
      switch (dir) {
        case 'LR': return 'from left to right';
        case 'RL': return 'from right to left';
        case 'TB':
        case 'TD': return 'from top to bottom';
        case 'BT': return 'from bottom to top';
      }
    }
    return 'with a clear directional flow';
  }

  function deriveDiagramTitle(mermaidCode, noteContent) {
    const src = String(mermaidCode == null ? '' : mermaidCode).replace(/\r/g, '');
    const m = /^\s*(?:%%\s*)?title\s*[:\s]\s*["']?(.+?)["']?\s*$/im.exec(src);
    if (m && m[1]) return m[1].trim();

    if (noteContent) {
      const lines = noteContent.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#') && !line.includes('```')) {
          return line.replace(/^#+\s*/, '').trim();
        }
      }
    }
    return 'プロセス構造図';
  }

  function buildInfographicImagePrompt(mermaidCode, noteContent, forcedStyle, defaultStyle) {
    const dirText = extractFlowDirectionText(mermaidCode);
    const title = deriveDiagramTitle(mermaidCode, noteContent);
    const styleName = forcedStyle || defaultStyle || 'material';
    const stylePrompt = getInfographicStylePrompt(styleName);

    return [
      `A high-quality ${stylePrompt}`,
      `REFERENCE (Mermaid code for understanding only; do NOT render this text verbatim): """\n${mermaidCode}\n"""`,
      `DIAGRAM FIDELITY (highest priority): The Mermaid code is the blueprint. Render a clean diagram/infographic that matches the Mermaid structure exactly: include every node and every edge; preserve branches/merges; preserve subgraph groupings as separate containers with titles; follow the declared direction (${dirText}).`,
      `TEXT FIDELITY: Copy node labels, decision labels, and subgraph titles from the Mermaid code VERBATIM. Do not translate, do not paraphrase, do not summarize Mermaid labels. Do not invent any new labels that are not present in the Mermaid code.`,
      `Text rendering: render clean, sharp, legible labels for nodes, decisions, and subgraph titles in Japanese (Noto Sans JP) or original language from the Mermaid diagram.`,
      `Slide layout: wide 16:9. Use a clean card composition: (1) a prominent header title '${title}' (normal-to-medium weight geometric sans), (2) a central diagram area following the Mermaid structure on crisp white cards with 28px rounded corners and 1px light border, (3) clear directional arrows with Action Blue accents.`,
      `Visual system: strict 8px spacing grid, Google Material Symbols Outlined line icons, consistent stroke weight, clear arrowheads, generous structural whitespace.`,
      `TITLE RULE: The slide must prominently display the header title: '${title}'.`,
      `NEGATIVE CONSTRAINTS: ${CLEAN_INFOGRAPHIC_NEGATIVES}`,
      `high resolution, 8k, sharp focus, aesthetic composition, publication-ready vector finish.`
    ].join(' ');
  }

  function isDedicatedImageModel(model) {
    if (!model || typeof model !== 'string') return false;
    const m = model.toLowerCase().trim();
    if (m.startsWith('imagen-') || m.endsWith('-image') || m.includes('banana')) return true;
    return false;
  }

  const api = {
    getInfographicStylePrompt: getInfographicStylePrompt,
    CLEAN_INFOGRAPHIC_STYLE: CLEAN_INFOGRAPHIC_STYLE,
    CLEAN_INFOGRAPHIC_NEGATIVES: CLEAN_INFOGRAPHIC_NEGATIVES,
    extractFlowDirectionText: extractFlowDirectionText,
    deriveDiagramTitle: deriveDiagramTitle,
    buildInfographicImagePrompt: buildInfographicImagePrompt,
    isDedicatedImageModel: isDedicatedImageModel
  };

  global.InfographicPrompt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
