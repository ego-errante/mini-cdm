# Filter VM Specification

Complete specification for Mini-CDM's stack-based bytecode virtual machine that evaluates encrypted data filters using Fully Homomorphic Encryption.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Opcodes Reference](#opcodes-reference)
- [Stack Specification](#stack-specification)
- [Bytecode Format](#bytecode-format)
- [Filter DSL](#filter-dsl)
- [Usage Examples](#usage-examples)
- [Performance Considerations](#performance-considerations)
- [Debugging](#debugging)

## Overview

The Filter VM is a stack-based virtual machine that evaluates boolean expressions over encrypted data without decryption. It enables privacy-preserving row filtering in dataset queries.

### Key Features

- **Stack-Based Execution**: Three specialized stacks (value, const, bool)
- **FHE Operations**: All comparisons use homomorphic encryption
- **Compact Bytecode**: Efficient binary encoding (~7-30 bytes typical)
- **Stack Depth Validation**: Maximum 8 elements per stack
- **DSL Compiler**: High-level TypeScript to bytecode translation

### Design Principles

1. **Minimal Instruction Set**: 11 opcodes cover all common filter patterns
2. **Type Safety**: Separate stacks prevent type confusion
3. **Gas Efficiency**: Optimized for on-chain execution
4. **Privacy**: Comparisons against plaintext constants only (no ciphertext-ciphertext)

## Architecture

### Execution Model

```
┌────────────────────────────────────────────────────────┐
│                    Filter VM                            │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Value Stack  │  │ Const Stack  │  │ Bool Stack   │ │
│  │ (euint64[8]) │  │ (uint64[8])  │  │ (ebool[8])   │ │
│  │              │  │              │  │              │ │
│  │ [encrypted]  │  │ [plaintext]  │  │ [encrypted]  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                  │         │
│         └─────────┬────────┴──────────────────┘         │
│                   │                                     │
│         ┌─────────▼──────────┐                         │
│         │  Execution Engine   │                         │
│         │  • Fetch opcode     │                         │
│         │  • Execute          │                         │
│         │  • Update stacks    │                         │
│         └─────────────────────┘                         │
│                                                         │
│  Input: bytes bytecode, uint256[] consts                │
│  Output: ebool keep (encrypted boolean)                 │
└────────────────────────────────────────────────────────┘
```

### Execution Flow

```
1. Initialize empty stacks
         ↓
2. Parse bytecode sequentially
         ↓
3. For each opcode:
   a. Read opcode byte
   b. Read parameters (if any)
   c. Pop operands from stacks
   d. Execute FHE operation
   e. Push result to stack
         ↓
4. Final validation:
   • Bool stack has exactly 1 element
   • Other stacks are empty
         ↓
5. Return top of bool stack
```

## Opcodes Reference

### Value Operations

#### PUSH_FIELD (0x01)

Push encrypted field value onto value stack.

**Format**: `0x01 <fieldIndex:uint16>`

**Parameters**:

- `fieldIndex`: Big-endian 16-bit field index (0-65535)

**Execution**:

```solidity
valueStack[valueSp++] = fields[fieldIndex];
```

**Example**:

```
0x01 0x00 0x03  // Push field[3]
```

#### PUSH_CONST (0x02)

Push plaintext constant onto const stack.

**Format**: `0x02 <constIndex:uint16>`

**Parameters**:

- `constIndex`: Big-endian 16-bit constant index

**Execution**:

```solidity
constStack[constSp++] = filter.consts[constIndex];
```

**Example**:

```
0x02 0x00 0x00  // Push consts[0]
```

### Comparison Operations

All comparisons pop one encrypted value and one plaintext constant, then push encrypted boolean result.

**Stack Effect**: `(euint64, uint64) → ebool`

| Opcode | Mnemonic | Solidity Operation               | Example Expression |
| :----- | :------- | :------------------------------- | :----------------- |
| `0x10` | `GT`     | `FHE.gt(encryptedVal, plainVal)` | `field[0] > 100`   |
| `0x11` | `GE`     | `FHE.ge(encryptedVal, plainVal)` | `field[1] >= 18`   |
| `0x12` | `LT`     | `FHE.lt(encryptedVal, plainVal)` | `field[2] < 1000`  |
| `0x13` | `LE`     | `FHE.le(encryptedVal, plainVal)` | `field[3] <= 65`   |
| `0x14` | `EQ`     | `FHE.eq(encryptedVal, plainVal)` | `field[4] == 42`   |
| `0x15` | `NE`     | `FHE.ne(encryptedVal, plainVal)` | `field[5] != 999`  |

### Logical Operations

#### AND (0x20)

Logical AND of two encrypted booleans.

**Format**: `0x20`

**Stack Effect**: `(ebool, ebool) → ebool`

**Execution**:

```solidity
ebool right = boolStack[--boolSp];
ebool left = boolStack[--boolSp];
ebool result = FHE.and(left, right);
boolStack[boolSp++] = result;
```

**Example**: `(age > 18) AND (salary < 100000)`

#### OR (0x21)

Logical OR of two encrypted booleans.

**Format**: `0x21`

**Stack Effect**: `(ebool, ebool) → ebool`

**Execution**:

```solidity
ebool right = boolStack[--boolSp];
ebool left = boolStack[--boolSp];
ebool result = FHE.or(left, right);
boolStack[boolSp++] = result;
```

**Example**: `(role == 1) OR (role == 2)`

#### NOT (0x22)

Logical NOT of encrypted boolean.

**Format**: `0x22`

**Stack Effect**: `ebool → ebool`

**Execution**:

```solidity
ebool operand = boolStack[--boolSp];
ebool result = FHE.not(operand);
boolStack[boolSp++] = result;
```

**Example**: `NOT (status == 0)`

## Stack Specification

### Stack Limits

Each stack has a maximum depth of 8 elements:

```solidity
euint64[8] memory valueStack;  // Encrypted field values
uint8 valueSp = 0;

uint64[8] memory constStack;   // Plaintext constants
uint8 constSp = 0;

ebool[8] memory boolStack;     // Encrypted boolean results
uint8 boolSp = 0;
```

### Stack Overflow/Underflow

**Overflow** (push to full stack):

```solidity
if (valueSp >= valueStack.length) revert FilterVMStackOverflow("value");
if (constSp >= constStack.length) revert FilterVMStackOverflow("const");
if (boolSp >= boolStack.length) revert FilterVMStackOverflow("bool");
```

**Underflow** (pop from empty stack):

```solidity
if (valueSp == 0) revert FilterVMStackUnderflow("value");
if (constSp == 0) revert FilterVMStackUnderflow("const");
if (boolSp == 0) revert FilterVMStackUnderflow("bool");
```

### Final State Validation

After bytecode execution:

```solidity
// Bool stack must have exactly 1 result
if (boolSp != 1) revert FilterVMInvalidFinalStackState();

// Other stacks must be empty
if (valueSp != 0) revert FilterVMStackNotEmpty("value");
if (constSp != 0) revert FilterVMStackNotEmpty("const");

return boolStack[0];  // Final result
```

## Bytecode Format

### Binary Encoding

Bytecode is a hex-encoded byte array with variable-length instructions:

```
Filter Program := Instruction+

Instruction :=
  | PUSH_FIELD <fieldIdx:uint16>    (3 bytes)
  | PUSH_CONST <constIdx:uint16>    (3 bytes)
  | GT | GE | LT | LE | EQ | NE     (1 byte)
  | AND | OR                         (1 byte)
  | NOT                              (1 byte)
```

### Encoding Rules

1. **Opcode**: Single byte
2. **16-bit Parameters**: Big-endian encoding (MSB first)
3. **No Padding**: Packed binary format
4. **Hex String**: Prefixed with `0x`

### Example Encoding

**Filter**: `field[0] > 100`

**DSL**:

```typescript
gt(0, 100);
```

**Bytecode**:

```
0x01 0x00 0x00   // PUSH_FIELD field[0]
0x02 0x00 0x00   // PUSH_CONST consts[0] (100)
0x10             // GT
```

**Constants**: `[100]`

**Result**: `{ bytecode: "0x0100000200000010", consts: [100] }`

## Filter DSL

### Overview

The Filter DSL is a TypeScript library that compiles high-level filter expressions to bytecode.

### Type Definition

```typescript
type FilterDSL =
  | ["GT" | "GE" | "LT" | "LE" | "EQ" | "NE", number, number]
  | ["AND" | "OR", FilterDSL, FilterDSL]
  | ["NOT", FilterDSL];
```

### Helper Functions

#### Comparison Helpers

```typescript
// field[0] > 100
gt(0, 100); // ["GT", 0, 100]

// field[1] >= 18
ge(1, 18); // ["GE", 1, 18]

// field[2] < 1000
lt(2, 1000); // ["LT", 2, 1000]

// field[3] <= 65
le(3, 65); // ["LE", 3, 65]

// field[4] == 42
eq(4, 42); // ["EQ", 4, 42]

// field[5] != 999
ne(5, 999); // ["NE", 5, 999]
```

#### Logical Helpers

```typescript
// (field[0] > 100) AND (field[1] < 500)
and(gt(0, 100), lt(1, 500));

// (field[2] == 1) OR (field[2] == 2)
or(eq(2, 1), eq(2, 2));

// NOT (field[3] == 0)
not(eq(3, 0));
```

### Compiler Function

```typescript
import { compileFilterDSL } from "@fhevm/shared";

const dsl = and(gt(0, 100), lt(1, 500));
const { bytecode, consts } = compileFilterDSL(dsl);

// bytecode: "0x..."
// consts: [100, 500]
```

### Stack Depth Validation

The compiler calculates required stack depth and validates against limits:

```typescript
function getExpressionMaxDepth(expr: FilterDSL): number {
  if (expr[0] === "NOT") {
    return getExpressionMaxDepth(expr[1]); // Reuses slot
  } else if (expr[0] === "AND" || expr[0] === "OR") {
    const leftDepth = getExpressionMaxDepth(expr[1]);
    const rightDepth = getExpressionMaxDepth(expr[2]);
    return Math.max(leftDepth, 1 + rightDepth);
  } else {
    return 1; // Comparison
  }
}

const depth = getExpressionMaxDepth(dsl);
if (depth > 8) {
  throw new Error("Filter exceeds max stack depth");
}
```

## Usage Examples

### Example 1: Simple Comparison

**Goal**: Select rows where age > 18

**DSL**:

```typescript
import { compileFilterDSL, gt } from "@fhevm/shared";

const filter = compileFilterDSL(gt(0, 18)); // field[0] = age
```

**Compiled**:

```javascript
{
  bytecode: "0x0100000200000010",
  consts: [18]
}
```

**Bytecode Breakdown**:

```
0x01 0x00 0x00  // PUSH_FIELD field[0]
0x02 0x00 0x00  // PUSH_CONST consts[0] = 18
0x10            // GT
```

**Stack Trace**:

```
Initial:
  valueStack: []
  constStack: []
  boolStack: []

After PUSH_FIELD(0):
  valueStack: [field[0]]
  constStack: []
  boolStack: []

After PUSH_CONST(0):
  valueStack: [field[0]]
  constStack: [18]
  boolStack: []

After GT:
  valueStack: []
  constStack: []
  boolStack: [field[0] > 18]  // encrypted boolean
```

### Example 2: Compound Condition

**Goal**: Select rows where `(age > 18) AND (salary < 100000)`

**DSL**:

```typescript
const filter = compileFilterDSL(
  and(
    gt(0, 18), // age > 18
    lt(1, 100000) // salary < 100000
  )
);
```

**Compiled**:

```javascript
{
  bytecode: "0x01000002000000100100010200000112000020",
  consts: [18, 100000]
}
```

**Bytecode Breakdown**:

```
0x01 0x00 0x00  // PUSH_FIELD field[0] (age)
0x02 0x00 0x00  // PUSH_CONST consts[0] = 18
0x10            // GT → bool1 = (age > 18)

0x01 0x00 0x01  // PUSH_FIELD field[1] (salary)
0x02 0x00 0x01  // PUSH_CONST consts[1] = 100000
0x12            // LT → bool2 = (salary < 100000)

0x20            // AND → result = bool1 AND bool2
```

**Stack Trace**:

```
After GT:
  boolStack: [age > 18]

After LT:
  boolStack: [age > 18, salary < 100000]

After AND:
  boolStack: [(age > 18) AND (salary < 100000)]
```

### Example 3: Complex Nested Logic

**Goal**: `((age > 18) AND (salary < 100k)) OR ((role == 1) AND NOT(status == 0))`

**DSL**:

```typescript
const filter = compileFilterDSL(
  or(and(gt(0, 18), lt(1, 100000)), and(eq(2, 1), not(eq(3, 0))))
);
```

**Compiled**:

```javascript
{
  bytecode: "0x0100000200000010010001020000011200200100020200000114010003020000011400220021",
  consts: [18, 100000, 1, 0]
}
```

**Execution Tree**:

```
                    OR
           ┌─────────┴─────────┐
          AND                 AND
       ┌───┴───┐           ┌───┴───┐
      GT      LT          EQ       NOT
    ┌─┴─┐   ┌─┴─┐       ┌─┴─┐      │
 age  18  sal 100k   role  1       EQ
                                  ┌─┴─┐
                               stat  0
```

### Example 4: Multi-Way Conditions

**Goal**: Select rows in age ranges: 18-25 OR 50-65

**DSL**:

```typescript
const filter = compileFilterDSL(
  or(
    and(ge(0, 18), le(0, 25)), // 18 <= age <= 25
    and(ge(0, 50), le(0, 65)) // 50 <= age <= 65
  )
);
```

## Performance Considerations

### Gas Costs

Filter VM operations are FHE-based and relatively expensive:

**Approximate Gas Costs** (on FHEVM):

| Operation                 | Gas Cost | Notes                 |
| ------------------------- | -------- | --------------------- |
| PUSH_FIELD                | ~2,000   | Load encrypted value  |
| PUSH_CONST                | ~500     | Load plaintext        |
| Comparison (GT, EQ, etc.) | ~50,000  | FHE comparison        |
| Logical (AND, OR)         | ~30,000  | FHE boolean operation |
| NOT                       | ~20,000  | FHE negation          |

**Example Costs**:

- Simple: `age > 18` → ~52,500 gas
- Compound: `(age > 18) AND (salary < 100k)` → ~133,000 gas
- Complex: 4 conditions with OR/AND → ~350,000+ gas

### Filter Complexity Impact

From gas benchmarking (see [GAS_BENCHMARKING.md](GAS_BENCHMARKING.md)):

| Filter  | Bytecode Size | Operations                 | Gas per Row |
| ------- | ------------- | -------------------------- | ----------- |
| None    | 0 bytes       | 0                          | ~500,000    |
| Simple  | ~7 bytes      | 1 comparison               | ~550,000    |
| Medium  | ~15 bytes     | 2 comparisons + AND        | ~625,000    |
| Complex | ~30 bytes     | 4 comparisons + AND/OR/NOT | ~750,000    |

**Coefficient**: ~0.013 per bytecode byte (from regression model)

### Optimization Tips

1. **Minimize Conditions**: Each comparison adds ~50k gas per row
2. **Use Simple Filters**: Prefer single comparisons when possible
3. **Short-Circuit Evaluation**: Put likely-false conditions first in AND
4. **Avoid Deep Nesting**: Keep expression trees shallow
5. **Prefer Left-Associative Operations**: Reduces stack depth significantly
6. **Reuse Constants**: Same constant can be pushed multiple times efficiently

#### Left-Associative vs Right-Associative

**Why It Matters**: The Filter VM has a maximum stack depth of 8 elements. Left-associative operations minimize peak stack depth during evaluation.

**Stack Depth Calculation**:

- For `and(A, B)`: depth = `max(depth(A), 1 + depth(B))`
- Left-associative chains evaluate left-to-right, keeping depth low
- Right-associative chains accumulate depth as they nest

**Example - Combining 4 conditions**:

```typescript
// ❌ BAD: Right-associative (depth = 4)
and(
  gt(0, 1), // depth = 1
  and(
    gt(1, 1), // depth = 1
    and(
      gt(2, 1), // depth = 1
      gt(3, 1) // depth = 1
    ) // depth = max(1, 1+1) = 2
  ) // depth = max(1, 1+2) = 3
); // depth = max(1, 1+3) = 4

// ✅ GOOD: Left-associative (depth = 2)
and(
  and(
    and(
      gt(0, 1), // depth = 1
      gt(1, 1) // depth = 1
    ), // depth = max(1, 1+1) = 2
    gt(2, 1) // depth = 1
  ), // depth = max(2, 1+1) = 2
  gt(3, 1) // depth = 1
); // depth = max(2, 1+1) = 2
```

**Practical Recommendation**:

- For **simple chains** (2-4 conditions): Left-associative is simplest
- For **many conditions** (5+ conditions): Consider balanced binary trees
- The DSL compiler doesn't optimize automatically - structure matters!

**Helper Function for Chaining**:

```typescript
/**
 * Chain multiple conditions with left-associative AND
 * Minimizes stack depth for long chains
 */
function chainAnd(...conditions: FilterDSL[]): FilterDSL {
  if (conditions.length === 0) throw new Error("No conditions");
  if (conditions.length === 1) return conditions[0];

  // Left-fold: and(and(and(c1, c2), c3), c4)
  return conditions.reduce((acc, condition) => and(acc, condition));
}

/**
 * Chain multiple conditions with left-associative OR
 */
function chainOr(...conditions: FilterDSL[]): FilterDSL {
  if (conditions.length === 0) throw new Error("No conditions");
  if (conditions.length === 1) return conditions[0];

  return conditions.reduce((acc, condition) => or(acc, condition));
}

// Usage
const filter = chainAnd(
  gt(0, 18), // age > 18
  lt(1, 100000), // salary < 100000
  eq(2, 1), // role == 1
  ne(3, 0), // status != 0
  ge(4, 5) // experience >= 5
);
// Compiled as: and(and(and(and(gt(0,18), lt(1,100000)), eq(2,1)), ne(3,0)), ge(4,5))
// Stack depth: 2 (instead of 5 for right-associative)
```

### Stack Depth Limits

**Maximum Depth**: 8 elements per stack

**Solution**: Flatten or split into multiple jobs

## Debugging

### Common Errors

#### FilterVMStackOverflow

**Cause**: Expression too deeply nested

**Error**:

```solidity
error FilterVMStackOverflow(string stackName);
```

**Fix**: Restructure the expression to be left-associative or a balanced tree to reduce stack depth. See the _'Left-Associative vs Right-Associative'_ discussion in the 'Performance Considerations' section for details.

#### FilterVMStackUnderflow

**Cause**: Malformed bytecode (pop from empty stack)

**Example**:

```typescript
// Missing PUSH_FIELD
const bytecode = "0x0200000010"; // PUSH_CONST, GT (no value!)
```

**Fix**: Use DSL compiler instead of manual bytecode

#### FilterVMInvalidFinalStackState

**Cause**: Multiple or zero results on bool stack

**Example**:

```typescript
// Two results left
and(gt(0, 1), gt(1, 1)); // Missing final AND
```

**Fix**: Ensure single boolean result

#### FilterVMInvalidFieldIndex

**Cause**: Field index exceeds row schema

**Error**:

```solidity
error FilterVMInvalidFieldIndex();
```

**Example**:

```typescript
// Dataset has 3 columns (0, 1, 2)
const filter = compileFilterDSL(gt(5, 100)); // field[5] doesn't exist
```

**Fix**: Use valid field indices (0 to numColumns-1)

### Bytecode Inspection

```typescript
function decodeBytecode(hex: string): string[] {..}

// Usage
const { bytecode, consts } = compileFilterDSL(and(gt(0, 18), lt(1, 100000)));
console.log(decodeBytecode(bytecode));
// ["PUSH_FIELD(0)", "PUSH_CONST(0)", "GT", "PUSH_FIELD(1)", "PUSH_CONST(1)", "LT", "AND"]
console.log("Constants:", consts);
// [18, 100000]
```

---

**Related Documentation**:

- [Request & Job Lifecycle](REQUEST_JOB_LIFECYCLE.md)
- [Architecture Guide](ARCHITECTURE.md)
- [Gas Benchmarking](GAS_BENCHMARKING.md)
