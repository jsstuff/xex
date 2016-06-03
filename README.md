xex.js
======

Lightweight and extensible math-like expression parser and compiler.

  * [Official Repository (exjs/xex)](https://github.com/exjs/xex)
  * [Official Chat (gitter)](https://gitter.im/exjs/exjs)
  * [Official Fiddler](http://kobalicek.com/fiddle-xex.html)
  * [Public Domain (https://unlicense.org)](https://unlicense.org)

Introduction
------------

xex.js is a lightweight library that provides API to parse mathematic-like expressions and to compile them into javascript functions of user-provided signatures. The library was designed to be small, hackable, and embeddable in other projects - it has no dependencies and all functionality fits into a single file. It was primarily designed for [xschema](https://github.com/exjs/xschema) library to provide support for expression constraints and access control rules, but since the library has much more use-cases it was separated from the original project.

The expression is internally represented as AST, unlike many other expression evaluators that use postfix notation. The reason to use AST was to make the library friendly for implementing new features. The library currently provides nearly full access to JS Math functionality with some additional features. It treats all variables as numbers and is currently designed to work only with numbers - that's it, no user-defined types, object, etc...

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
console.log(f({ 0.5, 0.25 }));
```

By default the compiled expression expects a single argument, which is an object where each property describes a variable inside the expression. Expressions are not static in most cases and there are currently two ways of checking whether the expression contains invalid variables:

  * Validating `exp.vars` after the expression was parsed (ideal for inspecting)
  * Using a variable whitelist (ideal for compiling user-defined expressions)

For example if the expression can use only variables `x` and `y` a whitelist can be created:

```js
// Values don't matter, only keys are important.
const whitelist = { x: true, y: 0 };

const exp0 = xex.exp("sin(x) * cos(y)", { varsWhitelist: whitelist }); // Ok.
const exp1 = xex.exp("sin(z) * cos(w)", { varsWhitelist: whitelist }); // Throws ExpressionError.
```

Also, by default the expression is simplified (constant folding). If you intend to process the expression tree and would like to see all nodes you can disable it, or trigger it manually:

```js
// Create the `Expression` instance without a constant folding pass.
const exp = xex.exp("sin(0.6) + cos(0.5) + x", { noFolding: true });

// Trigger constant folding manually, optionally you can substitude variables
// with constants.
exp.fold({ x: 1 });
```

Extending Guide
---------------

The library can be extended by user-defined constants, operators, and functions. The base environment `xex` is frozen and cannot be extended, however, it can be cloned and the clone can be then used the same way as `xex`:

```js
// Clone the base environment and add some constants (can be chained).
const env = xex.clone()
  .addConstant("ANSWER_TO_LIFE", 42)    // addConstant(name, value) syntax.
  .addConstant({ name: "ONE", value: 0 }) // addConstant(definition) syntax.

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

The `safe` option is pessimistic by default (false), so it's a good practice to always provide it depending on the function you are adding. If your custom function has side effects or returns a different answer every time it's called (like `Math.random()`) then it must not be considered safe.

TODO: Adding operators documentation.
