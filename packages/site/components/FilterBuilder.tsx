"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Trash2 } from "lucide-react";
import {
  FilterDSL,
  compileFilterDSL,
  CompiledFilter,
  gt,
  ge,
  lt,
  le,
  eq,
  ne,
  and,
  or,
  not,
} from "@fhevm/shared";

type ComparisonOp = "GT" | "GE" | "LT" | "LE" | "EQ" | "NE";
type LogicalOp = "AND" | "OR";

interface FilterCondition {
  id: string;
  fieldIndex: number;
  operator: ComparisonOp;
  value: number;
  negate?: boolean;
}

interface FilterBuilderProps {
  numColumns: number;
  onFilterChange: (compiledFilter: CompiledFilter | null) => void;
}

export function FilterBuilder({
  numColumns,
  onFilterChange,
}: FilterBuilderProps) {
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [logicalOp, setLogicalOp] = useState<LogicalOp>("AND");
  const [showBuilder, setShowBuilder] = useState(false);

  const operatorLabels: Record<ComparisonOp, string> = {
    GT: ">",
    GE: "≥",
    LT: "<",
    LE: "≤",
    EQ: "=",
    NE: "≠",
  };

  function addCondition() {
    const newCondition: FilterCondition = {
      id: Math.random().toString(36).substr(2, 9),
      fieldIndex: 0,
      operator: "GT",
      value: 0,
      negate: false,
    };
    setConditions([...conditions, newCondition]);
  }

  function removeCondition(id: string) {
    const updated = conditions.filter((c) => c.id !== id);
    setConditions(updated);
    compileAndNotify(updated, logicalOp);
  }

  function updateCondition(id: string, updates: Partial<FilterCondition>) {
    const updated = conditions.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    );
    setConditions(updated);
    compileAndNotify(updated, logicalOp);
  }

  function compileAndNotify(conds: FilterCondition[], combineOp: LogicalOp) {
    if (conds.length === 0) {
      onFilterChange(null);
      return;
    }

    try {
      // Build DSL from conditions
      const dslConditions: FilterDSL[] = conds.map((c) => {
        let expr: FilterDSL;

        switch (c.operator) {
          case "GT":
            expr = gt(c.fieldIndex, c.value);
            break;
          case "GE":
            expr = ge(c.fieldIndex, c.value);
            break;
          case "LT":
            expr = lt(c.fieldIndex, c.value);
            break;
          case "LE":
            expr = le(c.fieldIndex, c.value);
            break;
          case "EQ":
            expr = eq(c.fieldIndex, c.value);
            break;
          case "NE":
            expr = ne(c.fieldIndex, c.value);
            break;
        }

        return c.negate ? not(expr) : expr;
      });

      // Combine all conditions with the selected logical operator
      let finalDSL: FilterDSL = dslConditions[0];
      for (let i = 1; i < dslConditions.length; i++) {
        if (combineOp === "AND") {
          finalDSL = and(finalDSL, dslConditions[i]);
        } else {
          finalDSL = or(finalDSL, dslConditions[i]);
        }
      }

      console.log("finalDSL", finalDSL);
      // Compile to bytecode
      const compiled = compileFilterDSL(finalDSL);
      onFilterChange(compiled);
    } catch (error) {
      console.error("Filter compilation error:", error);
      onFilterChange(null);
    }
  }

  function handleLogicalOpChange(op: LogicalOp) {
    setLogicalOp(op);
    compileAndNotify(conditions, op);
  }

  function clearAll() {
    setConditions([]);
    onFilterChange(null);
  }

  if (!showBuilder) {
    return (
      <div className="space-y-2">
        <Label>Filter (optional)</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowBuilder(true)}
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Filter Conditions
        </Button>
        {conditions.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {conditions.length} condition{conditions.length !== 1 ? "s" : ""}{" "}
            active
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Filter Builder</Label>
        <div className="flex items-center gap-2">
          {conditions.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-8"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Clear
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowBuilder(false)}
            className="h-8"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Logical Operator Selection */}
      {conditions.length > 1 && (
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">Combine with:</Label>
          <Select
            value={logicalOp}
            onValueChange={(v) => handleLogicalOpChange(v as LogicalOp)}
          >
            <SelectTrigger className="w-24 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">AND</SelectItem>
              <SelectItem value="OR">OR</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Conditions List */}
      <div className="space-y-3">
        {conditions.map((condition, index) => (
          <div
            key={condition.id}
            className="flex items-start gap-2 p-3 bg-muted/50 rounded-md"
          >
            <div className="flex-1 grid grid-cols-12 gap-2 items-end">
              {/* Show logical operator between conditions */}
              {index > 0 && (
                <div className="col-span-12 -mt-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {logicalOp}
                  </Badge>
                </div>
              )}

              {/* NOT toggle */}
              <div className="col-span-2">
                <Label className="text-xs">NOT</Label>
                <Button
                  type="button"
                  variant={condition.negate ? "default" : "outline"}
                  size="sm"
                  onClick={() =>
                    updateCondition(condition.id, { negate: !condition.negate })
                  }
                  className="w-full h-9"
                >
                  {condition.negate ? "Yes" : "No"}
                </Button>
              </div>

              {/* Field Index */}
              <div className="col-span-3">
                <Label className="text-xs">Field</Label>
                <Select
                  value={condition.fieldIndex.toString()}
                  onValueChange={(v) =>
                    updateCondition(condition.id, { fieldIndex: parseInt(v) })
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: numColumns }, (_, i) => (
                      <SelectItem key={i} value={i.toString()}>
                        Field {i}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Operator */}
              <div className="col-span-3">
                <Label className="text-xs">Operator</Label>
                <Select
                  value={condition.operator}
                  onValueChange={(v) =>
                    updateCondition(condition.id, {
                      operator: v as ComparisonOp,
                    })
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(operatorLabels) as ComparisonOp[]).map(
                      (op) => (
                        <SelectItem key={op} value={op}>
                          {operatorLabels[op]} ({op})
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Value */}
              <div className="col-span-4">
                <Label className="text-xs">Value</Label>
                <Input
                  type="number"
                  value={condition.value}
                  onChange={(e) =>
                    updateCondition(condition.id, {
                      value: parseInt(e.target.value) || 0,
                    })
                  }
                  className="h-9"
                  placeholder="Enter value"
                />
              </div>
            </div>

            {/* Remove Button */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeCondition(condition.id)}
              className="h-9 w-9 mt-5"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add Condition Button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addCondition}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Condition
      </Button>

      {/* Summary */}
      {conditions.length > 0 && (
        <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
          <strong>Filter:</strong>{" "}
          {conditions.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ` ${logicalOp} `}
              {c.negate && "NOT "}
              (Field[{c.fieldIndex}] {operatorLabels[c.operator]} {c.value})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
