// xex.js <https://github.com/exjs/xex>
"use strict";

const assert = require("assert");
const hasOwn = Object.prototype.hasOwnProperty;

const xex = require("./xex");

// Automatically populate all functions defined by `xex`.
function getFuncs(nArgs) {
  const lang = xex.lang;
  const result = [];
  for (var k in lang)
    if (/^[A-Za-z_]\w*$/.test(k) && (nArgs >= lang[k].args && nArgs <= lang[k].amax))
      result.push(k);
  return result;
}
const Functions1 = getFuncs(1);
const Functions2 = getFuncs(2);
const Functions3 = getFuncs(3);

const Operators = [
  "+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "&&", "||"
];

const ValuesFull = [
  0, 0.5, 1, 1.5, -0.5, -1, -1.5, 2.5, -2.5, 3.33, -3.33,
  18014398509481984, -18014398509481984,
  NaN,
  Infinity, -Infinity
];

// Don't add anything here unless extremely necessary. Each value here could
// increase the time required by some tests in orders of magnitude.
const ValuesReduced = [0, 1.5];

// Check if two numbers are equal comparing `NaN === NaN` as true.
function bineq(x, y) {
  return x === y || (isNaN(x) && isNaN(y));
}

// Evaluates the `input` by replacing all built-in functions into `func` or `Math`.
// This is an alternative approach to verify that `xex` operator precedence matches JS.
function evalInput(input) {
  const lang = xex.lang;
  const modified = input.replace(/[A-Za-z_]\w+/g, function(name) {
    if (hasOwn.call(lang, name)) {
      const info = lang[name];
      const emit = info.emit;
      if (typeof emit === "string")
        return emit.substr(0, emit.indexOf("("));
    }
    return name;
  });
  // XEX uses '$' as a global which provides all registered functions.
  return +(Function("$", "return " + modified + ";"))(xex.func);
}

// Checks if `input`, which contains only a constant expression, is equal to
// the reference result evaluated by the JS engine.
function passConst(input) {
  const out = xex.exp(input).root;
  const ref = evalInput(input);

  if (typeof out !== "number")
    throw new Error(`Expression '${input}': Should reduce to '${ref}'`);

  if (!bineq(out, ref))
    throw new Error(`Expression '${input}': Should reduce to '${ref}', not ${out}`);
}

function passVars(input, vars, ref) {
  const exp = xex.exp(input, { varsWhitelist: vars });
  const out = exp.eval(vars);

  if (!bineq(out, ref))
    throw new Error(`Expression '${input}': Should evaluate to '${ref}', not ${out}`);
}

function fail(input, options) {
  var exp = null;

  try {
    exp = xex.exp(input, options);
  } catch (err) {
    return;
  }

  throw new Error(`Expression '${input}' should have thrown`);
}

describe("xex", function() {
  it("should handle operators (compatible with JS)", function() {
    for (var a of ValuesFull) {
      for (var b of ValuesFull) {
        for (var op of Operators) {
          passConst(`${a} ${op} ${b}`);
        }
      }
    }
  });

  it("should handle operators (precedence)", function() {
    this.timeout(60000);

    for (var a of ValuesReduced) {
      for (var b of ValuesReduced) {
        for (var c of ValuesReduced) {
          for (var d of ValuesReduced) {
            for (var op1 of Operators) {
              for (var op2 of Operators) {
                for (var op3 of Operators) {
                  passConst(`${a} ${op1} ${b} ${op2} ${c} ${op3} ${d}`);
                }
              }
            }
          }
        }
      }
    }
  });

  it("should handle operators (additional checks)", function() {
    passConst("1 + 2 * 3 / 4 * 5 % 6");
    passConst("2 * 3 / 4 * 5 % 6 + 1");

    passConst("-1 + -2 - -3 * -4");
    passConst("!1 + !2 - !3 * !4");
  });

  it("should handle operators (xex-specific)", function() {
    passVars("0 ~= 1"    , {}, 0);
    passVars("0 ~= NaN"  , {}, 0);
    passVars("0 ~= 0"    , {}, 1);
    passVars("NaN ~= NaN", {}, 1);
  });

  it("should handle basic functions of one argument", function() {
    for (var a of ValuesFull) {
      for (var fn of Functions1) {
        passConst(`${fn}(${a})`);
        passConst(`${fn}(${a} * ${a})`);
      }
    }
  });

  it("should handle basic functions of two arguments", function() {
    for (var a of ValuesFull) {
      for (var b of ValuesFull) {
        for (var fn of Functions2) {
          passConst(`${fn}(${a}, ${b})`);
          passConst(`${fn}(${a} * ${b}, ${b})`);
          passConst(`${fn}(${a}, ${a} * ${b})`);
        }
      }
    }
  });

  it("should handle basic functions of three arguments", function() {
    for (var a of ValuesFull) {
      for (var b of ValuesFull) {
        for (var c of ValuesFull) {
          for (var fn of Functions3) {
            passConst(`${fn}(${a}, ${b}, ${c})`);
          }
        }
      }
    }
  });

  it("should handle basic functions in compiled code", function() {
    passVars("isint(0)", {}, 1);
    passVars("isint(1)", {}, 1);
    passVars("isint(0.5)", {}, 0);
    passVars("isint(NaN)", {}, 0);
    passVars("isint(Infinity)", {}, 0);
    passVars("isint(-Infinity)", {}, 0);

    passVars("isinf(0)", {}, 0);
    passVars("isinf(1)", {}, 0);
    passVars("isinf(0.5)", {}, 0);
    passVars("isinf(NaN)", {}, 0);
    passVars("isinf(Infinity)", {}, 1);
    passVars("isinf(-Infinity)", {}, 1);

    passVars("isnan(0)", {}, 0);
    passVars("isnan(1)", {}, 0);
    passVars("isnan(0.5)", {}, 0);
    passVars("isnan(NaN)", {}, 1);
    passVars("isnan(Infinity)", {}, 0);
    passVars("isnan(-Infinity)", {}, 0);

    passVars("isfinite(0)", {}, 1);
    passVars("isfinite(1)", {}, 1);
    passVars("isfinite(0.5)", {}, 1);
    passVars("isfinite(NaN)", {}, 0);
    passVars("isfinite(Infinity)", {}, 0);
    passVars("isfinite(-Infinity)", {}, 0);
  });

  it("should handle variables", function() {
    passVars("x + y", { x: 2, y: 3 }, 5);
    passVars("x * y", { x: 2, y: 3 }, 6);
  });

  it("should handle invalid expression", function() {
    [
      "", " ", "+", "-", "(", ")", "-(", "-)", "-()", "(-)", "(0))", "((0)",
      "*x", "x+", "x-", "x+(x", "x+)", "x + y(", "x + y)", "x...",
      "sin(", "sin(x", "sin(x+", "sin(x))", "sin((x)", "sin(x (", "sin.x",
      "#x", "$x", "@x", "`x", "'x", "{x", "}x", "[x", "]x",
      "invalidFunctionName(x)"
    ].forEach(function(exp) {
      fail(exp);
    });
  });

  it("should handle invalid variable", function() {
    fail("sin(z)", { varsWhitelist: { x: true } });
  });

  it("should fold constants manually", function() {
    const exp = xex.exp("x + y");
    exp.fold({ x: 1, y: 2 });
    assert.strictEqual(exp.root, 3);
  });

  it("should add a new constant", function() {
    const env = xex.clone()
      .addConstant("X", 1)
      .addConstant({ name: "Y", value: 2});

    const exp = env.exp("X + Y");
    assert.strictEqual(exp.root, 3);
  });

  it("should add a new function (safe)", function() {
    const env = xex.clone().addFunction({
      name: "myfunc",
      args: 1,
      safe: true,
      eval: function(x) { return x + x; }
    });

    const exp = env.exp("myfunc(1)");
    assert.strictEqual(exp.root, 2);
  });

  it("should add a new function (unsafe)", function() {
    const env = xex.clone().addFunction({
      name: "myfunc",
      args: 1,
      safe: false,
      eval: function(x) { return x + x; }
    });

    const exp = env.exp("myfunc(1)");
    assert.notStrictEqual(exp.root, 2);
    assert.strictEqual(typeof exp.root, "object");
    assert.strictEqual(exp.root.type, "Call");
  });

  it("should add a new function (variadic)", function() {
    const env = xex.clone().addFunction({
      name: "sum",
      args: 1,
      amax: Infinity,
      safe: true,
      eval: function() {
        var x = 0;
        for (var i = 0; i < arguments.length; i++)
          x += arguments[i];
        return x;
      }
    });

    assert.strictEqual(env.exp("sum(1, 2, 3, 4)").root, 10);
  });

  it("should add a new operator (binary)", function() {
    const env = xex.clone().addBinary({
      name: "**",
      prec: 2,
      rtl : true, // Right associative.
      safe: true,
      eval: Math.pow
    });

    assert.strictEqual(env.exp("2 ** 3").root, 8);

    // Precedence tests.
    assert.strictEqual(env.exp("2 * 2 ** 3").root, 16);
    assert.strictEqual(env.exp("2 * (2 ** 3)").root, 16);

    assert.strictEqual(env.exp("2 ** 3 * 2").root, 16);
    assert.strictEqual(env.exp("(2 ** 3) * 2").root, 16);

    assert.strictEqual(env.exp("2 ** 3 ** 2").root, 512);
    assert.strictEqual(env.exp("2 ** (3 ** 2)").root, 512);
    assert.strictEqual(env.exp("(2 ** 3) ** 2").root, 64);
  });

  it("should compile a function with a custom signature", function() {
    const exp = xex.exp("x / y");
    const fn = exp.compile(["x", "y"]);
    assert.strictEqual(fn(8, 2), 4);

    // Invalid args.
    assert.throws(function() { exp.compile({});        });
    assert.throws(function() { exp.compile("x");       });
    assert.throws(function() { exp.compile("x", "y");  });
    assert.throws(function() { exp.compile(null);      });
    assert.throws(function() { exp.compile(undefined); });

    // `x` or `y` not referenced.
    assert.throws(function() { exp.compile([]);         });
    assert.throws(function() { exp.compile(["x"]);      });
    assert.throws(function() { exp.compile(["y"]);      });
    assert.throws(function() { exp.compile(["x", "z"]); });
  });

  it("should handle ternary if-else (basic)", function() {
    passConst("0   ? 2 : 4");
    passConst("1   ? 2 : 4");
    passConst("NaN ? 2 : 4");
  });

  it("should handle ternary if-else (extended)", function() {
    var isTaken = false;
    var isNotTaken = false;

    // Ternary if/else must take wither left or right side.
    function reset() { isTaken = false; isNotTaken = false; }
    function taken() { isTaken = true; return 1; }
    function notTaken() { isNotTaken = true; return 0; }

    const env = xex.clone()
      .addFunction({ name: "a", eval: taken   , args: 0, safe: false })
      .addFunction({ name: "b", eval: notTaken, args: 0, safe: false });

    const exp = env.exp("x ? a() : b()");

    assert.strictEqual(exp.eval({ x: 1 }), 1);
    assert.strictEqual(isTaken, true);
    assert.strictEqual(isNotTaken, false);
    reset();

    assert.strictEqual(exp.eval({ x: 0 }), 0);
    assert.strictEqual(isTaken, false);
    assert.strictEqual(isNotTaken, true);
    reset();
  });
});
