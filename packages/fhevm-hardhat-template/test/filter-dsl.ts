// Filter DSL compilation utilities

// DSL Filter Expression types
export type FilterDSL =
  | ["GT" | "GE" | "LT" | "LE" | "EQ" | "NE", number, number] // [op, fieldIndex, value]
  | ["AND" | "OR", FilterDSL, FilterDSL] // [op, left, right]
  | ["NOT", FilterDSL]; // [op, expr]

export interface CompiledFilter {
  bytecode: string; // hex string
  consts: number[]; // plaintext constants
}

/**
 * Compiles a JSON DSL filter expression to bytecode and constants
 * @param dsl The filter DSL expression
 * @returns Compiled bytecode and constants for FilterProg
 */
export function compileFilterDSL(dsl: FilterDSL, validate: boolean = true): CompiledFilter {
  const MAX_STACK_DEPTH = 8;

  /**
   * Calculates the maximum stack depth required to evaluate a DSL expression.
   * This is based on a post-order traversal of the expression tree, simulating
   * how the Filter VM would execute the bytecode.
   * For an expression (A op B), the VM first evaluates A, leaving one result.
   * Then it evaluates B, with A's result still on the stack.
   * The max depth is therefore max(depth(A), 1 + depth(B)).
   */
  function getExpressionMaxDepth(expr: FilterDSL): number {
    const op = expr[0];
    if (op === "NOT") {
      // NOT reuses the same stack slot, so depth doesn't change.
      return getExpressionMaxDepth(expr[1] as FilterDSL);
    } else if (op === "AND" || op === "OR") {
      // Binary expression: A op B
      const leftDepth = getExpressionMaxDepth(expr[1] as FilterDSL);
      const rightDepth = getExpressionMaxDepth(expr[2] as FilterDSL);
      return Math.max(leftDepth, 1 + rightDepth);
    } else {
      // Comparison expression, pushes one result.
      return 1;
    }
  }

  // Validate stack depth before compiling
  const requiredStackDepth = getExpressionMaxDepth(dsl);
  if (validate && requiredStackDepth > MAX_STACK_DEPTH) {
    throw new Error(`Filter DSL exceeds max stack depth. Required: ${requiredStackDepth}, Max: ${MAX_STACK_DEPTH}`);
  }

  const bytecode: number[] = [];
  const consts: number[] = [];

  function compile(expr: FilterDSL): void {
    if (expr[0] === "NOT") {
      // NOT expression
      compile(expr[1] as FilterDSL);
      bytecode.push(opcodes.NOT);
    } else if (expr[0] === "AND" || expr[0] === "OR") {
      // Binary logical expression
      compile(expr[1] as FilterDSL);
      compile(expr[2] as FilterDSL);
      bytecode.push(expr[0] === "AND" ? opcodes.AND : opcodes.OR);
    } else {
      // Comparison expression: [op, fieldIndex, value]
      const [op, fieldIndex, value] = expr as [string, number, number];

      // PUSH_FIELD
      bytecode.push(opcodes.PUSH_FIELD);
      bytecode.push((fieldIndex >> 8) & 0xff, fieldIndex & 0xff); // uint16 field index (big endian)

      // PUSH_CONST
      bytecode.push(opcodes.PUSH_CONST);
      const constIndex = consts.length;
      consts.push(value);
      bytecode.push((constIndex >> 8) & 0xff, constIndex & 0xff); // uint16 const index (big endian)

      // Comparator - use the opcodes enum values directly
      bytecode.push(opcodes[op as OpcodeName]);
    }
  }

  compile(dsl);

  // Convert bytecode to hex string
  const bytecodeHex = "0x" + bytecode.map((b) => b.toString(16).padStart(2, "0")).join("");

  return { bytecode: bytecodeHex, consts };
}

/**
 * Helper to create simple comparison filters
 */
export function gt(fieldIndex: number, value: number): FilterDSL {
  return ["GT", fieldIndex, value];
}

export function ge(fieldIndex: number, value: number): FilterDSL {
  return ["GE", fieldIndex, value];
}

export function lt(fieldIndex: number, value: number): FilterDSL {
  return ["LT", fieldIndex, value];
}

export function le(fieldIndex: number, value: number): FilterDSL {
  return ["LE", fieldIndex, value];
}

export function eq(fieldIndex: number, value: number): FilterDSL {
  return ["EQ", fieldIndex, value];
}

export function ne(fieldIndex: number, value: number): FilterDSL {
  return ["NE", fieldIndex, value];
}

export function and(left: FilterDSL, right: FilterDSL): FilterDSL {
  return ["AND", left, right];
}

export function or(left: FilterDSL, right: FilterDSL): FilterDSL {
  return ["OR", left, right];
}

export function not(expr: FilterDSL): FilterDSL {
  return ["NOT", expr];
}

// Test utilities for Filter VM bytecode construction
export const opcodes = {
  PUSH_FIELD: 0x01,
  PUSH_CONST: 0x02,
  GT: 0x10,
  GE: 0x11,
  LT: 0x12,
  LE: 0x13,
  EQ: 0x14,
  NE: 0x15,
  AND: 0x20,
  OR: 0x21,
  NOT: 0x22,
} as const;

// Type-safe union of valid opcode names
export type OpcodeName = keyof typeof opcodes;

/**
 * Converts instruction arrays to bytecode hex string
 * Instructions format: ['PUSH_FIELD', fieldIndex] | ['PUSH_CONST', constIndex] | ['GT'] | ['AND'] | etc.
 */
export function buildBytecode(instructions: (readonly [OpcodeName, ...number[]])[]): string {
  const bytecode: number[] = [];

  for (const instruction of instructions) {
    const [opcodeName, ...params] = instruction;
    const opcode = opcodes[opcodeName];
    bytecode.push(opcode);

    // Add parameter bytes (big endian for 16-bit values)
    for (const param of params) {
      bytecode.push((param >> 8) & 0xff, param & 0xff);
    }
  }

  return "0x" + bytecode.map((b) => b.toString(16).padStart(2, "0")).join("");
}
