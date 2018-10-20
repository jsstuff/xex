xex.js
======

Lightweight and extensible math-like expression parser and compiler.

  * [Official Repository (jsstuff/xex)](https://github.com/jsstuff/xex)
  * [Official Fiddler](http://kobalicek.com/fiddle-xex.html)
  * [Public Domain (https://unlicense.org)](https://unlicense.org)

Introduction
------------

xex.js is a lightweight library that provides API to parse mathematic-like expressions and to compile them into javascript functions of user-provided signatures. The library was designed to be small, hackable, and embeddable in other projects - it has no dependencies and all functionality fits into a single file. It was primarily designed for [xschema](https://github.com/jsstuff/xschema) library to provide support for expression constraints and access control rules, but since the library has much more use-cases it was separated from the original project.

The expression is internally represented as AST, unlike many other expression evaluators that use postfix notation. The reason to use AST was to make the library friendly for implementing new features. The library currently provides nearly full access to JS `Math` functionality with some additional features. It treats all variables as numbers and is currently designed to work only with numbers - that's it, no user-defined types, objects, etc...

The library can be probably extended in the future to provide more built-in functions and features - pull requests that add useful functionality to `xex` are more than welcome!

Basic Usage
-----------

Simple example:

```js
const xex = require("xex");

// Create the `Expression` instance:
const exp = xex.exp("sin(x) * cos(y)");
console.log(exp instanceof xex.Expression);

// Root node of the expression's AST.
// {
//   type: "Binary",
//   name: "*",
//   info: {...},
//   left: {
//     type: "Call",
//     name: "sin" ,
//     info: {...} ,
//     args: [...] }
//   },
//   right: {
//     type: "Call",
//     name: "cos" ,
//     info: {...} ,
//     args: [...] }
//   }
// }
console.log(exp.root);

// Map of all variables the expression uses:
// {
//   x: <node> ,
//   y: <node>
// }
console.log(exp.vars);

// Call the compiled function with `args`:
//   0.46452135963892854
const args = { x: 0.5, y: 0.25 };
console.log(exp.eval(args));

// The default compiled function is not bound to the
// expression, you can steal it and use it anywhere:
//   0.46452135963892854
const f = exp.eval;
console.log(f({ x: 0.5, y: 0.25 }));
```

By default the compiled expression expects a single argument, which is an object where each property describes a variable inside the expression. Expressions are not static in most cases and there are currently two ways of checking whether the expression contains invalid variables:

  * Validating `exp.vars` after the expression was parsed (ideal for inspecting)
  * Using a variable whitelist (ideal for compiling user-defined expressions)

For example if the expression can use only variables `x` and `y` it's better to use the whitelise:

```js
// Values don't matter, only keys are important.
const whitelist = { x: true, y: 0 };

const exp0 = xex.exp("sin(x) * cos(y)", { varsWhitelist: whitelist }); // Ok.
const exp1 = xex.exp("sin(z) * cos(w)", { varsWhitelist: whitelist }); // Throws ExpressionError.
```

If you need a different signature, for example a function where the first parameter is `x` and the second parameter `y`, you can compile it as well:

```js
const exp = xex.exp("sin(x) * cos(y)");
const fn = exp.compile(["x", "y"]);

console.log(fn(0.5, 0.25));
```

When the expression is compiled this way it checks all variables and will throw if it uses a variable that is not provided. The `xex.exp()` may throw as well, so it's always a good practice to enclose it in `try-catch` block:

```js
var fn;
try {
  fn = xex.exp("sin(x) * cos(y) + z").compile(["x", "y"]);
}
catch (ex) {
  // Exception should always be `ExpressionError` instance.
  console.log(ex instanceof xex.ExpressionError);

  // ERROR: Variable 'z' used, but no mapping provided
  console.log(`ERROR: ${ex.message}`);
}
```

The `ExpressionError` instance also contains a `position`, which describes where the error happened if it was a parser error:

```js
try {
  xex.exp("a : b");
}
catch (ex) {
  // ERROR: Unexpected token ':' at 2
  console.log(`ERROR: ${ex.message} at ${ex.position}`);
}
```

The `position` describes an index of the first token character from the beginning of the input. If the expression has multiple lines then you have to count lines and columns manually.

By default the expression is simplified (constant folding). If you intend to process the expression tree and would like to see all nodes you can disable it, or trigger it manually:

```js
// Create the `Expression` instance without a constant folding pass.
const exp = xex.exp("sin(0.6) + cos(0.5) + x", { noFolding: true });

// Traverse the parsed expression tree.
// {
//   ...
// }
console.log(JSON.stringify(exp.root, null, 2));

// Trigger constant folding manually - you can substitude variables with constants.
exp.fold({ x: 1 });

// 2.442225035285408
console.log(JSON.stringify(exp.root, null, 2));
```

Extending Guide
---------------

The library can be extended by user-defined constants, operators, and functions. The base environment `xex` is frozen and cannot be extended, however, it can be cloned and the clone can be then used the same way as `xex`:

```js
// Clone the base environment and add some constants (can be chained).
const env = xex.clone()
  .addConstant({ name: "ONE", value: 0 })
  .addConstant("ANSWER_TO_LIFE", 42) // Simplified syntax.

// Adding functions always require passing the definition:
env.addFunction({
  name: "sum"     // Required: Function name, must be a valid identifier name.
  args: 1,        // Required: Number of arguments or minimum number of arguments.
  amax: Infinity  // Optional: Maximum number of arguments, can be Infinity.
  safe: true,     // Optional: Evaluation has no side effects (default false).
  eval: function() {
    var x = 0;
    for (var i = 0; i < arguments.length; i++)
      x += arguments[i];
    return x;
  }
});

// The custom environment `env` acts as `xex`:
//   43
const exp = env.exp("sum(ANSWER_TO_LIFE, ONE)")
console.log(exp.eval());
```

The `safe` option is pessimistic by default (false), so it's a good practice to always provide it depending on the function you are adding. If your custom function has side effects or returns a different answer every time it's called (like `Math.random()`) then it must not be considered safe. Safe functions can be evaluated by constant folding if all their arguments are known (constants or already folded expressions).

Adding new operators is similar to adding functions with some minor differences: when adding operators you must provide precedence and associativity (`rtl`):

```js
const env = xex.clone();

// Use addUnary() or addBinary() to add new operators.
env.addBinary({
  name: "**",     // Required: Name          - Cannot conflict with identifier characters.
  prec: 2,        // Required: Precedence    - less means higher precedence.
  rtl : true,     // Optional: Associativity - Right (true) or left (false, default).
  safe: true,     // Optional: Evaluation has no side effects (default false).
  eval: Math.pow
});

console.log(env.exp("2 ** 3"       ).eval()); // 8
console.log(env.exp("2 ** 3 ** 2"  ).eval()); // 512
console.log(env.exp("(2 ** 3) ** 2").eval()); // 64
```

In that case the `Math.pow` function is used to evaluate the operator. However, you may want to add an operator that generates just JS code without calling any functions. To do so, you can use the `emit` property:

```js
const env = xex.clone();

// Add bit manupulation operators xex.js don't provide by default:
env.addBinary({ name: "&"  , prec:10, safe: true, eval: function(x, y) { return x & y   }, emit: "@1 & @2"   });
env.addBinary({ name: "|"  , prec:12, safe: true, eval: function(x, y) { return x | y   }, emit: "@1 | @2"   });
env.addBinary({ name: "^"  , prec:11, safe: true, eval: function(x, y) { return x ^ y   }, emit: "@1 ^ @2"   });
env.addBinary({ name: "<<" , prec: 7, safe: true, eval: function(x, y) { return x << y  }, emit: "@1 << @2"  });
env.addBinary({ name: ">>>", prec: 7, safe: true, eval: function(x, y) { return x >>> y }, emit: "@1 >>> @2" });
env.addBinary({ name: ">>" , prec: 7, safe: true, eval: function(x, y) { return x >> y  }, emit: "@1 >> @2"  });

console.log(env.exp("1234 & 333").eval()); // 64
console.log(env.exp("1234 | 333").eval()); // 1503
console.log(env.exp("1234 ^ 333").eval()); // 1439
```

The `eval` property is required for constant folding, the `emit` property is required by the expression compiler, which compiles expressions into native JS functions. The `emit` property is autogenerated if it's missing, like in was previous examples.

Hacking Guide
-------------

The library is based on the following ideas:

  * Tokenizer serializes the whole input into an array of tokens, where each token is object with properties describing the token.
  * Tokenizer uses a lookup table for the first `0..N` characters to categorize them faster (it doesn't use `isDigit`, `isAlpha`, and similar). If you intend to extend the tokenizer to understand unicode characters or some other special characters, check out `Category` function.
  * Tokenizer resolves operators in a way that if multiple punctuation characters follow each other it takes `N` of them and tries to resolve that part. If the operator is not found it decreases to `N - 1`, etc. For example the `<<<` would first try to resolve as `<<<`, then `<<`, and finally `<`.
  * Parser produces AST based on tokens from the tokenizer. Each language construct should have its own `parseSomething` implementation. The the moment there are just `parseExpression()` and `parseCall()` constructs provided.
  * Parser was abstracted as much as possible to use the `Environment`. Even unary if-else is defined through the global environment `xex` and the parser just implements the construct itself, it doesn't initially know that `?` and `:` mean unary-if/else.
  * AST is represented as plain JS objects, which are easy to serialize and traverse.
  * Constant folding must always use `safe` property provided by the operator or function specification (accessible as `node.info`). If `safe` is ignored it can lead to unpredictable results and hard to debug errors.
  * Each new feature must contain a unit test for successful case and failure case.

Built-In Features
-----------------

  * Unary operators:
    * Negate `-(x)`
    * Not `!(x)`
  * Arithmetic operators:
    * Addition `x + y`
    * Subtraction `x - y`
    * Multiplication `x * y`
    * Division `x / y`
    * Modulo `x % y`
  * Comparison operators:
    * Equal `x == y`
    * Not equal `x != y`
    * Greater `x > y`
    * Greater or equal `x >= y`
    * Lesser `x < y`
    * Lesser or equal `x <= y`
  * Language constructs:
    * Ternary if-else `condition ? taken : not-taken`
  * Functions:
    * Check for NaN `isnan(x)`
    * Check for infinity `isinf(x)`
    * Check for finite number `isfinite(x)`
    * Check for integer `isint(x)`
    * Check for safe integer `issafeint(x)`
    * Check for binary equality `isequal(x, y)`
      * `isequal(0, -0)` -> `0`
      * `isequal(42, 42)` -> `1`
      * `isequal(NaN, NaN)` -> `1`
    * Check between  `isbetween(x, min, max)`
      * returns `0` if `x` is `NaN`
    * Clamp `clamp(x, min, max)`
      * returns `NaN` if `x` is `NaN`
    * Sign `sign(x)`
      * `sign(0)` -> `0`
      * `sign(-0)` -> `-0`
      * `sign(NaN)` -> `NaN`
    * Round to nearest `round(x)`
      * `round(2.5)` -> `3`
    * Truncate `trunc(x)`
    * Floor `floor(x)`
    * Ceil `ceil(x)`
    * Absolute value `abs(x)`
    * Exponential `exp(x)`
    * Exponential minus one `expm1(x)`
      * the same as `exp(x) - 1`, but more precise.
    * Logarithm `log(x)`
    * Logarithm plus one `logp1(x)`
      * the same as `log(x + 1)`, but more precise.
    * Logarithm of base 2 `log2(x)`
    * Logarithm of base 10 `log10(x)`
    * Square root `sqrt(x)`
    * Cube root `cbrt(x)`
    * Fraction `frac(x)`
    * Sine `sin(x)`
    * Cosine `cos(x)`
    * Tangent `tan(x)`
    * Hyperbolic sine `sinh(x)`
    * Hyperbolic cosine `cosh(x)`
    * Hyperbolic tangent `tanh(x)`
    * Arcsine `asin(x)`
    * Arccosine `acos(x)`
    * Arctangent `atan(x)`
    * Arctangent `atan2(x, y)`
    * Hyperbolic arcsine `asinh(x)`
    * Hyperbolic arccosine `acosh(x)`
    * Hyperbolic arctangent `atanh(x)`
    * Power `pow(x, y)`
    * Square root of the sum of squares `hypot(x, y)`
    * Min/max `min(x, y...)` and `max(x, y...)`
      * returns `NaN` if one or more argument is `NaN`
    * Min/max value `minval(x, y...)` and `maxval(x, y...)`
      * skips `NaN` values, only returns `NaN` if all values are `NaN`
  * Constants:
    * Infinity `Infinity`
    * Not a Number `NaN`
    * PI `PI = 3.14159265358979323846`
