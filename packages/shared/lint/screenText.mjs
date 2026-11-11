/**
 * The lint of the text a person reads on screen (#2433): the measurable rules
 * of `docs/tech/interface-writing.md`, applied to the web app's strings and to
 * the backend's screen texts. Both packages' ESLint configs load it, so the
 * rules are stated here once; the guideline names each one by its number.
 *
 * - **1.** A sentence over 25 words.
 * - **2.** A semicolon, a spaced dash, or parentheses around four words or more.
 * - **3.** A sentence with three figures or more, literal or interpolated.
 * - **4.** A run of five digits or more with no separator.
 * - **5.** A date written by `toLocaleDateString()`, `toLocaleTimeString()` or a
 *   date's `toLocaleString()` without options.
 * - **6.** Four sentences or more in one text; a hint (`helperText`) of more than
 *   one sentence; a tooltip's `title` over 75 characters.
 * - **7.** An ADR or an issue number, in any string.
 *
 * What a text is: JSX text with the strings and expressions beside it, read as
 * one; a string, a template or a `+` chain given to a text prop or property
 * (`label`, `title`, `helperText`, `reason`, `statusMessage`…) or passed to a
 * screen call (`calls`, by name: the backend's error answers); and, unless `prose` is
 * off, any other string that reads as prose, three words or more and no SQL or
 * CSS. A string a program compares, imports, styles or logs is not one. Quoted
 * titles and addresses are taken out before a text is measured, so a title in
 * quotation marks or a licence credit's link adds no words, clauses or figures.
 * What a person wrote reaches the screen as data and is never a literal here.
 *
 * Allowed breaches of rules 1–6 are counted per file (`allow`: path →
 * { breaches, slice }). A file over its count reports every breach; a file
 * under it reports that the count is to be lowered, so the list only ever
 * shrinks. Rule 7 is never allowed where no screen broke it when the rule
 * arrived (the web app); where some did (`countRecords`, the backend, whose
 * refusal reasons are stored and compared run to run), it is counted too.
 *
 * Plain ESM with no imports: Node 22 loads it from both configs as it stands.
 */

const RECORD = /ADR-?\d{3,4}|\(#\d{3,5}\b|#\d{4,5}\b/;
const COLOUR_ONLY = /^#[0-9a-fA-F]{3,8}$/;

/** Props whose string a person reads. */
const TEXT_PROPS = new Set([
  'title', 'label', 'helperText', 'placeholder', 'alt', 'aria-label', 'aria-description',
  'primary', 'secondary', 'message', 'description', 'subheader', 'subtitle', 'caption',
  'heading', 'hint', 'emptyText', 'tooltip', 'text', 'about', 'how', 'summary',
  'error', 'reason', 'note', 'sentence', 'meaning', 'statusMessage', 'outcome',
]);
/** Props whose subtree is styling, routing or wiring, never read. */
const WIRING_PROPS = /^(className|sx|style|href|src|to|key|id|data-.*|variant|color|size|component|type|name|role|value|defaultValue|target|rel|htmlFor|fontSize|anchorOrigin|position|orientation|edge|align|direction|justifyContent|alignItems|width|height|loading|mode)$/;
const SILENT_CALLEES = /^(console|logger|log)\.|^(require|fetch|matchMedia|RegExp|querySelector|querySelectorAll|getElementById|addEventListener|removeEventListener|setAttribute|getAttribute|startsWith|endsWith|includes|indexOf|split|replace|replaceAll|match|test|has|get|delete|getItem|setItem|removeItem|createElement|encodeURIComponent|URL|URLSearchParams|append|set)$/;
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|FROM|WHERE|PREFIX|VALUES|JOIN|AS|CASE|COALESCE|NULLIF|OPTIONAL|FILTER|BIND|SERVICE)\b|\bwdt:|::[a-z]|\$\d+\b/;
/** A string of CSS declarations and nothing else: a property is lowercase, so "Note: …; …" is prose. */
const CSS_DECLARATIONS = /^(?:\s*[a-z-]+\s*:[^;:]*;)+\s*$/;
const CSS_VALUE = /\b\d+(?:px|em|rem|vh|vw|%)\b|rgba?\(|translate\(|cubic-bezier/;
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|St|Mt|No|Dr|Mr|Mrs|Ms|approx|cf|ca)\.$/;
const NUMERIC_NAME = /^(n|count|total|size|length|percent|pct|km|days|hours|minutes|seconds|bytes)$|(count|total|number|size|length|km|days|hours|minutes|seconds|bytes|percent|pct|share|readers|editions)$/i;
const NUMERIC_CALL = /^(toLocaleString|toFixed|format\w*|toPrecision)$/;
const PLACEHOLDER = '⟨x⟩';
const NUMBER_PLACEHOLDER = '⟨9⟩';

/** The name an expression stands for: `a.b.count` → `count`, `f(x)` → `f`. */
function lastName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return node.property.type === 'Identifier' ? node.property.name : '';
  if (node.type === 'CallExpression') return lastName(node.callee);
  if (node.type === 'ChainExpression' || node.type === 'TSNonNullExpression' || node.type === 'TSAsExpression') {
    return lastName(node.expression);
  }
  return '';
}

/** Whether an interpolated expression writes a figure. */
function isNumeric(node) {
  if (!node) return false;
  if (node.type === 'Literal') return typeof node.value === 'number';
  if (node.type === 'BinaryExpression') return ['+', '-', '*', '/', '%'].includes(node.operator) && (isNumeric(node.left) || isNumeric(node.right));
  if (node.type === 'CallExpression') {
    const name = lastName(node.callee);
    return NUMERIC_CALL.test(name) || NUMERIC_NAME.test(name) || name === 'round' || name === 'floor' || name === 'ceil';
  }
  return NUMERIC_NAME.test(lastName(node));
}

const placeholderOf = node => (isNumeric(node) ? NUMBER_PLACEHOLDER : PLACEHOLDER);

/** A template's text, its expressions as placeholders. */
function templateText(node) {
  return node.quasis.map(quasi => quasi.value.cooked ?? quasi.value.raw)
    .reduce((text, part, i) => text + part + (i < node.expressions.length ? placeholderOf(node.expressions[i]) : ''), '');
}

const isConcat = node => node?.type === 'BinaryExpression' && node.operator === '+';

/** The leaves of a `+` chain, left to right. */
function concatLeaves(node) {
  return isConcat(node) ? [...concatLeaves(node.left), ...concatLeaves(node.right)] : [node];
}

/** The text a string-ish node holds, or null where it holds none; a `+` chain reads as one text. */
function stringOf(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return templateText(node);
  if (isConcat(node)) {
    const leaves = concatLeaves(node);
    if (!leaves.some(leaf => stringOf(leaf) !== null)) return null;
    return leaves.map(leaf => stringOf(leaf) ?? placeholderOf(leaf)).join('');
  }
  return null;
}

/** The text a JSX child reads as, nested elements and strings included. */
function jsxChildText(child) {
  // JSX renders a line break in its source as a space; only a string's own `\n` is a line.
  if (child.type === 'JSXText') return child.value.replace(/\s+/g, ' ');
  // An element's text stands apart from its neighbours': a heading beside a paragraph is two words, not one.
  if (child.type === 'JSXElement' || child.type === 'JSXFragment') return ` ${child.children.map(jsxChildText).join('')} `;
  if (child.type === 'JSXExpressionContainer') {
    if (child.expression.type === 'JSXEmptyExpression') return '';
    const text = stringOf(child.expression);
    return text ?? placeholderOf(child.expression);
  }
  return '';
}

/** Take out what is not the writer's prose: quoted titles, addresses, entities. */
function prose(text) {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/“[^”]*”|"[^"]*"|‘[^’]*’|«[^»]*»/g, ' ⟨q⟩ ')
    // Lines stay apart, so a list of short lines reads as short lines (`sentences`).
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

const words = text => text.split(/\s+/).filter(word => /[\p{L}\p{N}⟨]/u.test(word));

/** The sentences of a text, lines and blank lines included as breaks. */
function sentences(text) {
  const parts = [];
  for (const line of text.split(/\n+/)) {
    let current = '';
    for (const token of line.split(/(?<=[.!?…])\s+/)) {
      current = current ? `${current} ${token}` : token;
      if (!ABBREVIATIONS.test(current)) {
        parts.push(current);
        current = '';
      }
    }
    if (current) parts.push(current);
  }
  return parts.map(part => part.trim()).filter(part => words(part).length > 0);
}

const figures = sentence => (sentence.match(/(?<![\p{L}\d])\d[\d,.]*|⟨9⟩/gu) ?? []).length;

/** Whether a string outside JSX and the text props reads as prose. */
function readsAsProse(text) {
  if (SQL.test(text) || CSS_DECLARATIONS.test(text) || CSS_VALUE.test(text)) return false;
  return text.split(/\s+/).filter(word => /^[\p{L}][\p{L}'’-]*[.,:!?]?$/u.test(word) && word.length > 1).length >= 3;
}

/** Every breach of rules 1–4 and 6 a text holds: [rule, what]. */
export function breaches(raw, { hint = false, tooltip = false } = {}) {
  const found = [];
  const text = prose(raw);
  // A separator or a mark holds no words: `{i > 0 && '; '}` joins two credits, not two clauses.
  if (!/\p{L}/u.test(text)) return found;
  const all = sentences(text);
  for (const sentence of all) {
    const count = words(sentence).length;
    if (count > 25) found.push([1, `a sentence of ${count} words; at most 25`]);
    if (figures(sentence) >= 3) found.push([3, 'three figures or more in one sentence; put them in a table or labelled lines']);
  }
  if (/;/.test(text)) found.push([2, 'a semicolon joins two clauses; make them two sentences']);
  if (/\s[—–]\s/.test(text)) found.push([2, 'a spaced dash joins or breaks a clause']);
  for (const [, inside] of text.matchAll(/\(([^()]*)\)/g)) {
    if (words(inside).length >= 4) found.push([2, 'parentheses around four words or more hold an aside']);
  }
  if (/(?<![\p{L}\d.,#/_-])\d{5,}(?![\p{L}\d])/u.test(text)) found.push([4, 'five digits or more with no separator; format the number in the reader\'s locale']);
  // A line with no sentence end is a list item or an example, the labelled lines rule 3 asks for.
  const said = text.includes('\n') ? all.filter(sentence => /[.!?…][\s"'”’»)]*$/.test(sentence)) : all;
  if (said.length >= 4) found.push([6, `${said.length} sentences in one text; at most three`]);
  if (hint && all.length > 1) found.push([6, 'a hint holds one sentence']);
  if (tooltip && raw.trim().length > 75) found.push([6, `a tooltip of ${raw.trim().length} characters; at most 75`]);
  return found;
}

/** The JSX attribute a node stands in, through conditionals and logical expressions. */
function attributeOf(node) {
  let current = node.parent;
  let child = node;
  while (current) {
    if (current.type === 'JSXAttribute') return current;
    if (current.type === 'JSXExpressionContainer' || current.type === 'ConditionalExpression' && child !== current.test
      || current.type === 'LogicalExpression' || current.type === 'TemplateLiteral') {
      child = current;
      current = current.parent;
      continue;
    }
    return null;
  }
  return null;
}

/** The expression a value stands for once a conditional or a fallback has chosen it: `a ? 'x' : 'y'` for 'x'. */
function chosenValue(node) {
  let value = node;
  while (value.parent?.type === 'ConditionalExpression' && value.parent.test !== value || value.parent?.type === 'LogicalExpression') {
    value = value.parent;
  }
  return value;
}

/** The expression a string is composed into: a `+` chain, a template or a choice, up to what consumes it. */
function composedValue(node) {
  let value = node;
  for (let up = value.parent; up; up = up.parent) {
    if (!(up.type === 'BinaryExpression' && up.operator === '+' || up.type === 'TemplateLiteral'
      || up.type === 'ConditionalExpression' && up.test !== value || up.type === 'LogicalExpression')) break;
    value = up;
  }
  return value;
}

const LOG_CALL = /^(console|logger|log)\./;

/** Whether a property's value ends in a log call's argument: `console.log({ message: '…' })` is a log line. */
function consumedByLog(node) {
  let value = composedValue(chosenValue(node));
  while (value.parent?.type === 'Property' && value.parent.value === value) value = composedValue(value.parent.parent);
  const call = value.parent;
  return call?.type === 'CallExpression' && call.arguments.includes(value) && call.callee.type === 'MemberExpression'
    && LOG_CALL.test(`${lastName(call.callee.object)}.${lastName(call.callee)}`);
}

/** Whether a string stands where a program reads it, not a person. */
function isWiring(node) {
  const { parent } = node;
  if (!parent) return true;
  if (parent.type === 'TaggedTemplateExpression') return true;
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression', 'TSLiteralType',
    'TSExternalModuleReference', 'SwitchCase', 'JSXAttribute'].includes(parent.type)) return true;
  if (parent.type === 'Property' && parent.key === node && !parent.computed) return true;
  if (parent.type === 'MemberExpression' && parent.property === node) return true;
  if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!=', 'in', 'instanceof'].includes(parent.operator)) return true;
  if ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.arguments.includes(node)) {
    const callee = parent.callee;
    const name = callee.type === 'MemberExpression'
      ? `${lastName(callee.object)}.${lastName(callee)}`
      : lastName(callee);
    if (SILENT_CALLEES.test(name) || SILENT_CALLEES.test(lastName(callee))) return true;
  }
  for (let up = parent; up; up = up.parent) {
    if (up.type === 'JSXAttribute') return WIRING_PROPS.test(up.name.name ?? '');
    if (up.type === 'TaggedTemplateExpression' || up.type === 'TSTypeAnnotation' || up.type === 'TSTypeAliasDeclaration') return true;
    if (up.type === 'Program') break;
  }
  return false;
}

/** Whether an element holds text of its own, beside any element it holds. */
function holdsText(element) {
  if (['style', 'script', 'code', 'pre'].includes(element.openingElement?.name?.name)) return false;
  return element.children.some(child => child.type === 'JSXText' && child.value.trim()
    || child.type === 'JSXExpressionContainer' && stringOf(child.expression) !== null);
}

/**
 * The element a JSX text is measured at: the outermost one holding text of its
 * own, every JSX ancestor walked, so a text is read once and whole however
 * many elements without text stand between.
 */
function isTextRoot(element) {
  if (!holdsText(element)) return false;
  for (let up = element.parent; up; up = up.parent) {
    // An ancestor reads a conditional as a placeholder, so the text is measured here or nowhere.
    if (up.type === 'LogicalExpression' || up.type === 'ConditionalExpression') return true;
    if ((up.type === 'JSXElement' || up.type === 'JSXFragment') && holdsText(up)) return false;
    if (up.type === 'JSXElement' || up.type === 'JSXFragment' || up.type === 'JSXExpressionContainer') continue;
    return true;
  }
  return true;
}

const DATE_NAME = /(^date$|Date$|^date|At$|^time$|Time$|^when$|^now$)/;

/** Whether `x.toLocaleString()` is called on a date. */
function isDateReceiver(object) {
  if (object.type === 'NewExpression' && lastName(object.callee) === 'Date') return true;
  return DATE_NAME.test(lastName(object));
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Text on screen follows the measurable rules of docs/tech/interface-writing.md (#2433)' },
    schema: [{
      type: 'object',
      properties: {
        allow: { type: 'object', additionalProperties: { type: 'object', properties: { breaches: { type: 'integer' }, slice: { type: 'string' } }, required: ['breaches', 'slice'] } },
        prose: { type: 'boolean' },
        calls: { type: 'array', items: { type: 'string' } },
        countRecords: { type: 'boolean' },
      },
      additionalProperties: false,
    }],
    messages: {
      breach: 'Text on screen, rule {{rule}} of docs/tech/interface-writing.md: {{what}}.',
      record: 'Text on screen, rule 7 of docs/tech/interface-writing.md: it names no ADR or issue number. Say what the person needs to know in plain words.',
      stale: 'This file has {{count}} breaches of the screen-text rules, under the {{allowed}} its allowance names: lower it to {{count}}, or remove the entry at 0.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const filename = context.filename.replaceAll('\\', '/');
    const allowance = Object.entries(options.allow ?? {}).find(([path]) => filename.endsWith(`/${path}`) || filename === path)?.[1];
    const pending = [];

    const add = (node, raw, flags = {}) => {
      for (const [ruleNumber, what] of breaches(raw, flags)) pending.push({ node, messageId: 'breach', data: { rule: String(ruleNumber), what } });
    };
    // A development record is never allowed: no screen named one when the rule arrived.
    const record = (node, raw) => {
      const at = node.type === 'TemplateElement' ? node.parent : node;
      if (!RECORD.test(raw) || COLOUR_ONLY.test(raw) || SQL.test(node.type === 'TemplateElement' ? templateText(at) : raw)) return;
      // Measured where the composed string is consumed: `console.log('ADR-0101: ' + status)` is a log line.
      if (node.type !== 'JSXText' && isWiring(composedValue(at)) && !attributeOf(at)) return;
      if (options.countRecords) pending.push({ node, messageId: 'record' });
      else context.report({ node, messageId: 'record' });
    };
    const screenCalls = new Set(options.calls ?? []);

    /** The name a string is given: the property, the assigned member or the screen call it stands in. */
    const givenName = node => {
      const value = chosenValue(node);
      const { parent } = value;
      if (parent?.type === 'Property' && parent.value === value) return lastName(parent.key);
      if (parent?.type === 'AssignmentExpression' && parent.right === value) return lastName(parent.left);
      return '';
    };
    const inScreenCall = node => {
      const value = chosenValue(node);
      const { parent } = value;
      if (!(parent?.type === 'CallExpression' || parent?.type === 'NewExpression') || !parent.arguments.includes(value)) return false;
      return screenCalls.has(lastName(parent.callee));
    };

    const measureString = (node, raw) => {
      const attribute = attributeOf(node);
      if (attribute) {
        const name = attribute.name.name ?? '';
        if (!TEXT_PROPS.has(name)) return;
        const element = attribute.parent?.name?.name ?? '';
        add(node, raw, { hint: name === 'helperText', tooltip: name === 'title' && /Tooltip$/.test(element) });
        return;
      }
      // A string a JSX child chooses is on screen whatever its length: its element reads the choice as a placeholder.
      const chosen = chosenValue(node);
      if (chosen !== node && chosen.parent?.type === 'JSXExpressionContainer' && chosen.parent.parent?.type !== 'JSXAttribute') {
        add(node, raw);
        return;
      }
      if (node.parent?.type === 'JSXExpressionContainer' && node.parent.parent?.type !== 'JSXAttribute') return;
      // A named text destination is measured before the SQL guess: "Could not UPDATE this place; try again." is an answer.
      if (inScreenCall(node) || TEXT_PROPS.has(givenName(node)) && !consumedByLog(node)) {
        add(node, raw);
        return;
      }
      if (SQL.test(raw)) return;
      if (isWiring(node) || consumedByLog(node)) return;
      if (options.prose !== false && readsAsProse(raw)) add(node, raw);
    };

    return {
      JSXText(node) { record(node, node.value); },
      Literal(node) { if (typeof node.value === 'string') record(node, node.value); },
      TemplateElement(node) { record(node, node.value.raw); },
      // A fragment holds text as an element does: `{done ? <>Reads …</> : null}`, `return <>…</>`.
      'JSXElement, JSXFragment'(node) {
        if (isTextRoot(node)) add(node, node.children.map(jsxChildText).join(''));
      },
      // A string inside a `+` chain is measured with the chain, at its top.
      'Literal:exit'(node) {
        if (typeof node.value === 'string' && !isConcat(node.parent)) measureString(node, node.value);
      },
      'TemplateLiteral:exit'(node) {
        if (node.parent?.type !== 'TaggedTemplateExpression' && !isConcat(node.parent)) measureString(node, templateText(node));
      },
      'BinaryExpression:exit'(node) {
        if (!isConcat(node) || isConcat(node.parent)) return;
        const text = stringOf(node);
        if (text !== null) measureString(node, text);
      },
      CallExpression(node) {
        const { callee } = node;
        // No options (the second argument): a locale alone still writes the date in numbers.
        if (callee.type !== 'MemberExpression' || node.arguments.length >= 2) return;
        const name = lastName(callee);
        if (name === 'toLocaleDateString' || name === 'toLocaleTimeString' || name === 'toLocaleString' && isDateReceiver(callee.object)) {
          pending.push({ node, messageId: 'breach', data: { rule: '5', what: `${name}() without options writes a date in numbers; write the day and the month in words` } });
        }
      },
      'Program:exit'(program) {
        if (allowance && pending.length <= allowance.breaches) {
          if (pending.length < allowance.breaches) {
            context.report({ node: program, messageId: 'stale', data: { count: String(pending.length), allowed: String(allowance.breaches) } });
          }
          return;
        }
        for (const report of pending) context.report(report);
      },
    };
  },
};

export default { rules: { guideline: rule } };
