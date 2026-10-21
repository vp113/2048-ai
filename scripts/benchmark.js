'use strict';

// Compatibility entry: the batch benchmark now lives in ai-benchmark.js.
// Both commands accept the same arguments:
//   node scripts/benchmark.js --games 10
//   node scripts/ai-benchmark.js --games 10

const benchmark = require('./ai-benchmark.js');

benchmark.run();
