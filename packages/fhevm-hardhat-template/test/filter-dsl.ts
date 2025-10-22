/**
 * Filter DSL utilities - re-exported from @fhevm/shared
 * This file maintains backward compatibility for test imports
 */

export {
  type FilterDSL,
  type CompiledFilter,
  type OpcodeName,
  compileFilterDSL,
  gt,
  ge,
  lt,
  le,
  eq,
  ne,
  and,
  or,
  not,
  opcodes,
  buildBytecode,
} from "@fhevm/shared";
