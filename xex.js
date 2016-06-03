// xex.js <https://github.com/exjs/xex>
(function($export, $as) {
"use strict";

$export[$as] = (function() {

const hasOwn = Object.prototype.hasOwnProperty;
const freeze = Object.freeze;
const isArray = Array.isArray;
const NoObject = freeze(Object.create(null));

/**
 * Version in "major.minor.patch" form.
 *
 * @alias xex.VERSION
 */
const VERSION = "0.0.2";

// ----------------------------------------------------------------------------
// [ExpressionError]
// ----------------------------------------------------------------------------

/**
 * Error class used by xex.
 *
 * Contains `message` and `position` members. If the `position` is not `-1`
 * then it is a zero-based index, which points to a first character of the
 * token near the error.
 */
class ExpressionError extends Error {
  constructor(message, position) {
    super(message);
    this.name = "ExpressionError";
    this.message = message;
    this.position = position != null ? position : -1;
  }
}

function throwExpressionError(message, position) {
  throw new ExpressionError(message, position);
}

// ----------------------------------------------------------------------------
// [Expression & Utilities]
// ----------------------------------------------------------------------------

function newVar(name) {
  return { type: "Var", name: name };
}
function newUnary(name, info, value) {
  return { type: "Unary", name: name, info: info, value: value };
}
function newBinary(name, info, left, right) {
  return { type: "Binary", name: name, info: info, left: left, right: right };
}
function newCall(name, info, args) {
  return { type: "Call", name: name, info: info, args: args };
}
function isValue(node) {
  return typeof node === "number";
}
function cloneNode(node) {
  if (node === null || typeof node !== "object")
    return node;

  switch (node.type) {
    case "Var"   : return node; // Variable nodes are immutable.
    case "Unary" : return newUnary(node.name, node.info, cloneNode(node.value));
    case "Binary": return newBinary(node.name, node.info, cloneNode(node.left), cloneNode(node.right));
    case "Call"  : return newCall(node.name, node.info, node.args.map(cloneNode));

    default:
      throwExpressionError(`Node '${node.type}' not recognized`);
  }
}
function accessProp(name) {
  return /^[A-Za-z_\$][\w\$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

/**
 * Parsed expression.
 *
 * Expression contains the whole expression tree and provides API to perform
 * basic manipulation and to compile the expression into a native JS function.
 *
 * @alias xex.Expression
 */
class Expression {
  constructor(env, root) {
    this.env = env;
    this.root = root != null ? root : null;
    this.dirty = false;
    this.$eval = null;
    this.$vars = null;
  }

  clone() {
    return new Expression(this.env, cloneNode(this.root));
  }

  fold(cmap) {
    this.root = this.$onNodeFold(this.root, cmap);
    this._checkDirty();
    return this;
  }

  compile(args) {
    // Build `varr` and `vmap` based on the input arguments.
    if (!isArray(args))
      throwExpressionError(`Argument 'args' must be an array, not '${typeof args}'`);

    const varr = [];
    const vmap = Object.create(null);

    for (var i = 0; i < args.length; i++) {
      const name = args[i];
      if (hasOwn.call(vmap, name))
        throwExpressionError(`Variable '${name}' provided multiple times`);

      const ident = "_" + String(i + 1);
      varr.push(ident);
      vmap[name] = ident;
    }

    return this.$onFuncCompile(this.root, vmap, varr);
  }

  compileBody(vmap) {
    if (typeof vmap !== "string" && typeof vmap !== "object")
      throwExpressionError(`Argument 'vmap' must be a string or object, not '${typeof vmap}'`);

    return this.$onNodeCompile(this.root, vmap);
  }

  get eval() {
    if (this.$eval === null)
      this.$eval = this.$onFuncCompile(this.root, "v", null);
    return this.$eval;
  }

  get vars() {
    if (this.$vars === null) {
      this.$vars = Object.create(null);
      this.$onNodeInfo(this.root);
    }
    return this.$vars;
  }

  _checkDirty() {
    if (this.dirty) {
      this.dirty = false;
      this.$eval = null;
      this.$vars = null;
    }
  }

  $onNodeInfo(node) {
    if (node === null || typeof node !== "object")
      return;

    switch (node.type) {
      case "Var":
        this.$vars[node.name] = node;
        break;
      case "Unary":
        this.$onNodeInfo(node.value);
        break;
      case "Binary":
        this.$onNodeInfo(node.left);
        this.$onNodeInfo(node.right);
        break;
      case "Call":
        const args = node.args;
        for (var i = 0; i < args.length; i++)
          this.$onNodeInfo(args[i]);
        break;
      default:
        throwExpressionError(`Node '${node.type}' not recognized`);
    }
  }

  $onNodeFold(node, cmap) {
    if (node === null || typeof node !== "object")
      return node;

    const info = node.info;
    switch (node.type) {
      case "Var": {
        if (cmap && hasOwn.call(cmap, node.name)) {
          this.dirty = true;
          return cmap[node.name];
        }
        return node;
      }
      case "Unary": {
        const child = node.value = this.$onNodeFold(node.value, cmap);
        if (info.safe && isValue(child)) {
          this.dirty = true;
          return info.eval(child);
        }
        return node;
      }
      case "Binary": {
        const left = node.left = this.$onNodeFold(node.left, cmap);
        const right = node.right = this.$onNodeFold(node.right, cmap);

        if (info.safe && isValue(left) && isValue(right)) {
          this.dirty = true;
          return info.eval(left, right);
        }
        return node;
      }
      case "Call": {
        const args = node.args;
        for (var i = 0; i < args.length; i++)
          args[i] = this.$onNodeFold(args[i], cmap);

        if (info.safe && args.every(isValue)) {
          this.dirty = true;
          return info.eval.apply(info, args);
        }
        return node;
      }

      default:
        throwExpressionError(`Node '${node.type}' not recognized`);
    }
  }

  $onFuncCompile(node, vmap, varr) {
    const decl = [];
    const args = [];

    decl.push("$");
    args.push(this.env.func);

    const signature = varr ? varr.join(", ") : vmap;
    const body = this.$onNodeCompile(node, vmap);

    decl.push(`return function(${signature}) {\n` +
              `  return ${body};\n` +
              `}\n`);
    try {
      return Function.apply(null, decl).apply(null, args);
    }
    catch (ex) {
      throw new ExpressionError(`${ex.message}: ${body}`);
    }
  }

  $onNodeCompile(node, vmap) {
    if (isValue(node))
      return String(node);

    const info = node.info;
    switch (node.type) {
      case "Var": {
        const name = node.name;
        if (typeof vmap === "string")
          return vmap + accessProp(name);

        if (!hasOwn.call(vmap, name))
          throwExpressionError(`Variable '${name}' used, but no mapping provided`);
        return vmap[node.name];
      }
      case "Unary": {
        return info.emit.replace(/@1/g, () => {
          return this.$onNodeCompile(node.value, vmap);
        });
      }
      case "Binary": {
        return info.emit.replace(/@[1-2]/g, (p) => {
          return this.$onNodeCompile(p === "@1" ? node.left : node.right, vmap);
        });
      }
      case "Call": {
        const args = node.args;
        return info.emit.replace(/(?:@args|@[1-2])/g, (p) => {
          if (p !== "@args")
            return this.$onNodeCompile(args[parseInt(p.substr(1), 10)], vmap);

          var s = "";
          for (var i = 0; i < args.length; i++) {
            if (s) s += ", ";
            s += this.$onNodeCompile(args[i], vmap);
          }
          return s;
        });
      }

      default:
        throwExpressionError(`Node '${node.type}' not recognized`);
    }
  }
}

// ----------------------------------------------------------------------------
// [Tokenization & Parsing]
// ----------------------------------------------------------------------------

const kCharNone  = 0;                 // '_' - Character category - Invalid or <end>.
const kCharSpace = 1;                 // 'S' - Character category - Space.
const kCharAlpha = 2;                 // 'A' - Character category - Alpha [A-Za-z_].
const kCharDigit = 3;                 // 'D' - Character category - Digit [0-9].
const kCharPunct = 4;                 // '$' - Character category - Punctuation.

const Category = (function(_, S, A, D, $) {
  const Table = freeze([
    _,_,_,_,_,_,_,_,_,S,S,S,S,S,_,_,  // 000-015 |.........     ..|
    _,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,  // 016-031 |................|
    S,$,$,$,$,$,$,$,$,$,$,$,$,$,$,$,  // 032-047 | !"#$%&'()*+,-./|
    D,D,D,D,D,D,D,D,D,D,$,$,$,$,$,$,  // 048-063 |0123456789:;<=>?|
    $,A,A,A,A,A,A,A,A,A,A,A,A,A,A,A,  // 064-079 |@ABCDEFGHIJKLMNO|
    A,A,A,A,A,A,A,A,A,A,A,$,$,$,$,A,  // 080-095 |PQRSTUVWXYZ[\]^_|
    $,A,A,A,A,A,A,A,A,A,A,A,A,A,A,A,  // 096-111 |`abcdefghijklmno|
    A,A,A,A,A,A,A,A,A,A,A,$,$,$,$,_,  // 112-127 |pqrstuvwxyz{|}~ |
    _,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,  // 128-143 |................|
    _,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_   // 144-159 |................|
  ]);
  const kTableLength = Table.length;

  return function(c) {
    if (c < kTableLength)
      return Table[c];
    return kCharNone;
  };
})(kCharNone, kCharSpace, kCharAlpha, kCharDigit, kCharPunct);

const kTokenNone  = 0;                // Invalid token, should be only used with `NoToken`.
const kTokenPunct = 1;                // Token is a punctuation, used to recognize operators.
const kTokenIdent = 2;                // Token is an identifier name (variable or function).
const kTokenValue = 3;                // Token is a value.
const kMaxOperatorLen = 4;            // Maximum length of a single operator.

function newToken(type, position, data, value) {
  return {
    type    : type,                   // Token type, see `kToken...`.
    position: position,               // Token position from the beginning of the input.
    data    : data,                   // Token data (content) as string.
    value   : value                   // Token value (only if the token is a value).
  };
}
const NoToken = freeze(newToken(kTokenNone, -1, "<end>", null));

// Must be reset before it can be used, use `RegExp.lastIndex`.
const reValue = /(?:(?:\d*\.\d+|\d+)(?:[E|e][+|-]?\d+)?)/g;

function rightAssociate(info, bPrec) {
  return info.prec > bPrec || (info.prec === bPrec && info.rtl);
}

function throwTokenError(token) {
  throw new ExpressionError(`Unexpected token '${token.data}'`, token.position);
}

class Parser {
  constructor(env, options) {
    this.env = env;                   // Expression environment (features).
    this.exp = null;                  // Expression instance, created in `parse()`.
    this.options = options;           // Expression options.
    this.vars = Object.create(null);  // Parsed variables name to node mapping.
    this.tIndex = 0;                  // Current token index, used during parsing.
    this.tokens = [];                 // Tokens array.
  }

  tokenize(input) {
    const tokens = this.tokens;       // Tokens array.
    const env = this.env;             // Expression environment.
    const len = input.length;         // Input length.

    var i = 0, j = 0;                 // Current index in `input` and a helper variable.
    var start = 0;                    // Current token start position.
    var data = "";                    // Current token data (content) as string.
    var c, cat;                       // Current character code and category.

    while (i < len) {
      cat = Category(c = input.charCodeAt(i));

      if (cat === kCharSpace) {
        i++;
      }
      else if (cat === kCharDigit) {
        const n = tokens.length - 1;
        if (n >= 0 && tokens[n].data === "." && input[i - 1] === ".") {
          tokens.length = n;
          i--;
        }
        reValue.lastIndex = i;
        data = reValue.exec(input)[0];

        tokens.push(newToken(kTokenValue, i, data, parseFloat(data)));
        i += data.length;
      }
      else if (cat === kCharAlpha) {
        start = i;
        while (++i < len && ((cat = Category(input.charCodeAt(i))) === kCharAlpha || cat === kCharDigit))
          continue;

        data = input.substring(start, i);
        tokens.push(newToken(kTokenIdent, start, data, null));
      }
      else if (cat === kCharPunct) {
        start = i;
        while (++i < len && Category(input.charCodeAt(i)) === kCharPunct)
          continue;

        data = input.substring(start, i);
        do {
          for (j = Math.min(i - start, kMaxOperatorLen); j > 0; j--) {
            const part = input.substr(start, j);
            if (env.get(part) || j === 1) {
              tokens.push(newToken(kTokenPunct, start, part, null));
              start += j;
              break;
            }
          }
        } while (start < i);
      }
      else {
        throwExpressionError(`Unrecognized character '0x${c.toString(16)}'`, i);
      }
    }
    return this;
  }

  skip()  { this.tIndex++                  ; return this; }
  back(t) { this.tIndex -= +(t !== NoToken); return this; }

  peek()  { return this.tIndex < this.tokens.length ? this.tokens[this.tIndex  ] : NoToken; }
  next()  { return this.tIndex < this.tokens.length ? this.tokens[this.tIndex++] : NoToken; }

  parse() {
    // The root expression cannot be empty.
    var token = this.peek();
    if (token === NoToken) throwTokenError(token);

    this.exp = new Expression(this.env, null);
    this.exp.root = this.parseExpression();

    // The root expression must reach the end of the input.
    token = this.peek();
    if (token !== NoToken) throwTokenError(token);

    return this.exp;
  }

  parseExpression() {
    const stack = [];

    const env = this.env;
    const options = this.options;
    const whitelist = options.varsWhitelist;

    var value = null;
    var info = null;

    for (;;) {
      var token = this.next();
      var unaryFirst = null;
      var unaryLast = null;

      // Parse a possible unary operator(s).
      value = null;
      if (token.type === kTokenPunct) {
        do {
          const name = "unary" + token.data;
          if (!(info = env.get(name))) break;

          const node = newUnary(name, info, value);
          if (unaryLast)
            unaryLast.value = node;
          else
            unaryFirst = node;

          unaryLast = node;
          token = this.next();
        } while (token.type === kTokenPunct);
      }

      // Parse a value, variable, function call, or nested expression.
      if (token.type === kTokenValue) {
        value = token.value;
      }
      else if (token.type === kTokenIdent) {
        const name = token.data;
        info = env.get(name);

        if (this.peek().data === "(") {
          if (!info)
            throwExpressionError(`Function ${name} not defined`, token.position);
          if (info.type !== "Function")
            throwExpressionError(`Variable ${name} cannot be used as function`, token.position);
          value = this.parseCall(token, info);
        }
        else {
          if (info && info.type === "Function")
            throwExpressionError(`Function ${name} cannot be used as variable`, token.position);

          if (info && info.type === "Constant") {
            value = info.value;
          }
          else {
            if (whitelist && !hasOwn.call(whitelist, name))
              throwExpressionError(`Variable ${name} is not on the whitelist`, token.position);
            value = this.vars[name] || (this.vars[name] = newVar(name));
          }
        }
      }
      else if (token.data === "(") {
        value = this.parseExpression();
        token = this.next();

        if (token.data !== ")")
          throwTokenError(token);
      }
      else {
        throwTokenError(token);
      }

      // Replace the value with the top-level unary operator, if parsed.
      if (unaryFirst) {
        unaryLast.value = value;
        value = unaryFirst;
      }

      // Parse a possible binary operator - the loop must repeat if present.
      token = this.peek();
      if (token.type === kTokenPunct && (info = env.get(token.data))) {
        const name = token.data;
        const bNode = newBinary(name, info, null, null);

        this.skip();
        if (!stack.length) {
          bNode.left = value;
          stack.push(bNode);
        }
        else {
          var aNode = stack.pop();
          var aPrec = aNode.info.prec;
          var bPrec = bNode.info.prec;

          if (aPrec > bPrec) {
            aNode.right = bNode;
            bNode.left = value;
            stack.push(aNode, bNode);
          }
          else {
            aNode.right = value;

            // Advance to the top-most op that has less/equal precedence than `bPrec`.
            while (stack.length) {
              if (rightAssociate(aNode.info, bPrec))
                break;
              aNode = stack.pop();
            }

            if (!stack.length && !rightAssociate(aNode.info, bPrec)) {
              bNode.left = aNode;
              stack.push(bNode);
            }
            else {
              const tmp = aNode.right;
              aNode.right = bNode;
              bNode.left = tmp;
              stack.push(aNode, bNode);
            }
          }
        }
      }
      else {
        break;
      }
    }

    if (value === null)
      throwExpressionError("Invalid state");

    if (stack.length === 0)
      return value;

    stack[stack.length - 1].right = value;
    return stack[0];
  }

  parseCall(func, info) {
    const name = func.data;
    const args = [];

    var token = this.next();
    if (token.data !== "(") throwTokenError(token);

    for (;;) {
      token = this.peek();
      if (token.data === ")") break;

      if (args.length !== 0) {
        if (token.data !== ",")
          throwTokenError(token);
        this.skip();
      }

      args.push(this.parseExpression());
    }

    this.skip();
    if (args.length < info.args || args.length > info.amax) {
      if (info.args === info.amax)
        throwExpressionError(`Function '${name}' accepts ${info.args} argument(s), ${args.length} provided`);
      else
        throwExpressionError(`Function '${name}' accepts ${info.args} to ${info.amax} argument(s), ${args.length} provided`);
    }
    return newCall(name, info, args);
  }
}

// ----------------------------------------------------------------------------
// [Environment]
// ----------------------------------------------------------------------------

/**
 * Environment - defines operators, functions, and constants.
 */
class Environment {
  constructor() {
    this.lang = Object.create(null);
    this.func = Object.create(null);
    this.frozen = false;

    this.VERSION = VERSION;
    this.Expression = Expression;
    this.ExpressionError = ExpressionError;
  }

  /**
   * Creates a new `Expression` from `input`.
   *
   * Options:
   *   - `noFolding` {boolean} If true the `Expression` returned won't be
   *      simplified - it disables constant folding
   *
   *   - `varsWhitelist` {object} If passed, the parser will recognize only
   *      variables, which are whitelisted (by using `hasOwnProperty` call).
   *
   * @param {string} input Input string.
   * @param {object} [options]
   *
   * @return {Expression} A new `Expression` instance.
   * @throws {ExpresionError} If tokenizer, parser, or analysis failed.
   */
  exp(input, options) {
    if (typeof input !== "string")
      throwExpressionError(`Argument 'input' must be a string, not '${typeof input}'`);

    if (options == null) options = NoObject;
    const exp = new Parser(this, options).tokenize(input).parse();

    if (options.noFolding !== true) exp.fold();
    return exp;
  }

  clone() {
    const cloned = new Environment();
    Object.assign(cloned.lang, this.lang);
    Object.assign(cloned.func, this.func);
    return cloned;
  }

  freeze() {
    freeze(this.lang);
    freeze(this.func);

    this.frozen = true;
    return freeze(this);
  }

  get(name) {
    return this.lang[name] || null;
  }

  add(def) {
    if (this.frozen)
      throwExpressionError(`Environment is frozen`);

    const type = def.type;
    const name = def.name;

    if (typeof name !== "string")
      throwExpressionError(`Identifier name be string, not '${typeof name}'`);

    if (hasOwn.call(this.lang, name))
      throwExpressionError(`Identifier '${name}' already defined`);

    switch (type) {
      case "Constant":
        if (typeof def.value !== "number")
          throwExpressionError(`Constant '${name}' must be a number, not '${typeof value}'`);
        break;
      case "Operator":
        if (typeof def.prec !== "number"  ) throwExpressionError(`${type} '${name}' must provide 'prec' property`);
        if (typeof def.rtl  !== "boolean" ) throwExpressionError(`${type} '${name}' must provide 'rtl'  property`);
        /* [[fallthrough]] */
      case "Function":
        if (typeof def.args !== "number"  ) throwExpressionError(`${type} '${name}' must provide 'args' property`);
        if (typeof def.amax !== "number"  ) throwExpressionError(`${type} '${name}' must provide 'amax' property`);
        if (typeof def.emit !== "string"  ) throwExpressionError(`${type} '${name}' must provide 'emit' property`);
        if (typeof def.eval !== "function") throwExpressionError(`${type} '${name}' must provide 'eval' property`);
        this.func[name] = def.eval;
        break;
      default:
        throwExpressionError(`Type '${type}' not recognized`);
    }

    this.lang[name] = freeze(def);
    return this;
  }

  addConstant(def) {
    const name  = typeof def === "object" ? def.name : def;
    const value = typeof def === "object" ? def.value : arguments[1];

    return this.add({
      type: "Constant",
      name: name,
      value: value
    });
  }

  addUnary(def) {
    return this.add({
      type: "Operator",
      name: "unary" + def.name,
      args: 1,
      amax: 1,
      prec: def.prec || 0,
      rtl : Boolean(def.rtl),
      safe: def.safe !== false,
      eval: def.eval,
      emit: def.emit || `$${accessProp(def.name)}(@1)`
    });
  }

  addBinary(def) {
    return this.add({
      type: "Operator",
      name: def.name,
      args: 2,
      amax: 2,
      prec: def.prec || 0,
      rtl : Boolean(def.rtl),
      safe: def.safe !== false,
      eval: def.eval,
      emit: def.emit || `$${accessProp(def.name)}(@1, @2)`
    });
  }

  addFunction(def) {
    return this.add({
      type: "Function",
      name: def.name,
      args: def.args,
      amax: typeof def.amax === "number" ? def.amax : def.args,
      prec: 0,
      rtl : false,
      safe: def.safe !== false,
      eval: def.eval,
      emit: def.emit || `$${accessProp(def.name)}(@args)`
    });
  }

  del(name) {
    if (this.frozen)
      throwExpressionError(`Environment is frozen`);

    delete this.lang[name];
    delete this.func[name];

    return this;
  }
}

// Use "+" to coerce booleans to numbers where required as `xex` works with numbers only.
function frac(x)      { return x - Math.floor(x); }
function isnan(x)     { return +Number.isNaN(x); }
function isinf(x)     { return +(x === Infinity || x === -Infinity); }
function isfinite(x)  { return +Number.isFinite(x); }
function isint(x)     { return +Number.isInteger(x); }
function issafeint(x) { return +Number.isSafeInteger(x); }
function bineq(x, y)  { return +(x === y || (Number.isNaN(x) && Number.isNaN(y))); }

function minmaxval(op) {
  return function() {
    var i = 0, len = arguments.length;
    var x = NaN, y = 0;

    while (i < len && Number.isNaN(x = arguments[i++]))
      continue;

    while (i < len)
      if (!Number.isNaN(y = arguments[i++]))
        x = op(x, y);

    return x;
  };
}

const N = Infinity;
return new Environment()
  .addConstant({ name: "Infinity" , value: Infinity })
  .addConstant({ name: "NaN"      , value: NaN      })
  .addConstant({ name: "PI"       , value: Math.PI  })
  .addUnary   ({ name: "-"        , prec: 3, rtl : 1, safe: true, eval: function(val) { return  -val; }, emit: "-(@1)"   })
  .addUnary   ({ name: "!"        , prec: 3, rtl : 1, safe: true, eval: function(val) { return +!val; }, emit: "+!(@1)"  })
  .addBinary  ({ name: "+"        , prec: 6, rtl : 0, safe: true, eval: function(x,y) { return x + y; }, emit: "@1 + @2" })
  .addBinary  ({ name: "-"        , prec: 6, rtl : 0, safe: true, eval: function(x,y) { return x - y; }, emit: "@1 - @2" })
  .addBinary  ({ name: "*"        , prec: 5, rtl : 0, safe: true, eval: function(x,y) { return x * y; }, emit: "@1 * @2" })
  .addBinary  ({ name: "/"        , prec: 5, rtl : 0, safe: true, eval: function(x,y) { return x / y; }, emit: "@1 / @2" })
  .addBinary  ({ name: "%"        , prec: 5, rtl : 0, safe: true, eval: function(x,y) { return x % y; }, emit: "@1 % @2" })
  .addBinary  ({ name: "&&"       , prec:13, rtl : 0, safe: true, eval: function(x,y) { return +(x &&  y); }, emit: "+(@1 && @2)"  })
  .addBinary  ({ name: "||"       , prec:14, rtl : 0, safe: true, eval: function(x,y) { return +(x ||  y); }, emit: "+(@1 || @2)"  })
  .addBinary  ({ name: "=="       , prec: 9, rtl : 0, safe: true, eval: function(x,y) { return +(x === y); }, emit: "+(@1 === @2)" })
  .addBinary  ({ name: "!="       , prec: 9, rtl : 0, safe: true, eval: function(x,y) { return +(x !== y); }, emit: "+(@1 !== @2)" })
  .addBinary  ({ name: "~="       , prec: 9, rtl : 0, safe: true, eval: bineq })
  .addBinary  ({ name: "<"        , prec: 8, rtl : 0, safe: true, eval: function(x,y) { return +(x <   y); }, emit: "+(@1 < @2)"  })
  .addBinary  ({ name: "<="       , prec: 8, rtl : 0, safe: true, eval: function(x,y) { return +(x <=  y); }, emit: "+(@1 <= @2)" })
  .addBinary  ({ name: ">"        , prec: 8, rtl : 0, safe: true, eval: function(x,y) { return +(x >   y); }, emit: "+(@1 > @2)"  })
  .addBinary  ({ name: ">="       , prec: 8, rtl : 0, safe: true, eval: function(x,y) { return +(x >=  y); }, emit: "+(@1 >= @2)" })
  .addFunction({ name: "isinf"    , args: 1, amax: 1, safe: true, eval: isinf })
  .addFunction({ name: "isint"    , args: 1, amax: 1, safe: true, eval: isint    , emit: "+Number.isInteger(@1)"})
  .addFunction({ name: "issafeint", args: 1, amax: 1, safe: true, eval: issafeint, emit: "+Number.isSafeInteger(@1)"})
  .addFunction({ name: "isnan"    , args: 1, amax: 1, safe: true, eval: isnan    , emit: "+Number.isNaN(@1)"})
  .addFunction({ name: "isfinite" , args: 1, amax: 1, safe: true, eval: isfinite , emit: "+Number.isFinite(@1)" })
  .addFunction({ name: "abs"      , args: 1, amax: 1, safe: true, eval: Math.abs    })
  .addFunction({ name: "sign"     , args: 1, amax: 1, safe: true, eval: Math.sign   })
  .addFunction({ name: "round"    , args: 1, amax: 1, safe: true, eval: Math.round  })
  .addFunction({ name: "trunc"    , args: 1, amax: 1, safe: true, eval: Math.trunc  })
  .addFunction({ name: "floor"    , args: 1, amax: 1, safe: true, eval: Math.floor  })
  .addFunction({ name: "ceil"     , args: 1, amax: 1, safe: true, eval: Math.ceil   })
  .addFunction({ name: "frac"     , args: 1, amax: 1, safe: true, eval: frac        })
  .addFunction({ name: "sqrt"     , args: 1, amax: 1, safe: true, eval: Math.sqrt   })
  .addFunction({ name: "cbrt"     , args: 1, amax: 1, safe: true, eval: Math.cbrt   })
  .addFunction({ name: "exp"      , args: 1, amax: 1, safe: true, eval: Math.exp    })
  .addFunction({ name: "expm1"    , args: 1, amax: 1, safe: true, eval: Math.expm1  })
  .addFunction({ name: "log"      , args: 1, amax: 1, safe: true, eval: Math.log    })
  .addFunction({ name: "log2"     , args: 1, amax: 1, safe: true, eval: Math.log2   })
  .addFunction({ name: "log10"    , args: 1, amax: 1, safe: true, eval: Math.log10  })
  .addFunction({ name: "sin"      , args: 1, amax: 1, safe: true, eval: Math.sin    })
  .addFunction({ name: "sinh"     , args: 1, amax: 1, safe: true, eval: Math.sinh   })
  .addFunction({ name: "cos"      , args: 1, amax: 1, safe: true, eval: Math.cos    })
  .addFunction({ name: "cosh"     , args: 1, amax: 1, safe: true, eval: Math.cosh   })
  .addFunction({ name: "tan"      , args: 1, amax: 1, safe: true, eval: Math.tan    })
  .addFunction({ name: "tanh"     , args: 1, amax: 1, safe: true, eval: Math.tanh   })
  .addFunction({ name: "asin"     , args: 1, amax: 1, safe: true, eval: Math.asin   })
  .addFunction({ name: "asinh"    , args: 1, amax: 1, safe: true, eval: Math.asinh  })
  .addFunction({ name: "acos"     , args: 1, amax: 1, safe: true, eval: Math.acos   })
  .addFunction({ name: "acosh"    , args: 1, amax: 1, safe: true, eval: Math.acosh  })
  .addFunction({ name: "atan"     , args: 1, amax: 1, safe: true, eval: Math.atan   })
  .addFunction({ name: "atanh"    , args: 1, amax: 1, safe: true, eval: Math.atanh  })
  .addFunction({ name: "min"      , args: 2, amax: N, safe: true, eval: Math.min    })
  .addFunction({ name: "minval"   , args: 2, amax: N, safe: true, eval: minmaxval(Math.min) })
  .addFunction({ name: "max"      , args: 2, amax: N, safe: true, eval: Math.max    })
  .addFunction({ name: "maxval"   , args: 2, amax: N, safe: true, eval: minmaxval(Math.max) })
  .addFunction({ name: "pow"      , args: 2, amax: 2, safe: true, eval: Math.pow    })
  .addFunction({ name: "atan2"    , args: 2, amax: 2, safe: true, eval: Math.atan2  })
  .addFunction({ name: "hypot"    , args: 2, amax: 2, safe: true, eval: Math.hypot  });
})();

}).apply(this, typeof module === "object" ? [module, "exports"] : [this, "xex"]);
