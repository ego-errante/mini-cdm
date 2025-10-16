#!/usr/bin/env python3
"""
Gas Benchmark Analysis Script

This script analyzes the gas benchmark results from GasBenchmark.ts
and builds a linear regression model to estimate gas costs.

Usage:
    python analyze_gas_results.py gas_benchmark_results.csv

Requirements:
    pip install pandas scikit-learn matplotlib seaborn
"""

import sys
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_absolute_percentage_error
import matplotlib.pyplot as plt
import seaborn as sns

def load_and_prepare_data(csv_path):
    """Load CSV and prepare features for regression"""
    print(f"\n{'='*60}")
    print("Loading data...")
    print(f"{'='*60}\n")
    
    df = pd.read_csv(csv_path)
    print(f"Loaded {len(df)} test cases")
    print(f"\nColumns: {list(df.columns)}")
    
    # Map filter complexity to approximate bytecode lengths
    filter_bytecode_map = {
        'none': 0,
        'simple': 7,
        'medium': 15,
        'complex': 30
    }
    df['FilterBytes'] = df['FilterComplexity'].map(filter_bytecode_map)
    
    print(f"\nData preview:")
    print(df.head())
    
    return df

def analyze_basic_statistics(df):
    """Print basic statistics about gas costs"""
    print(f"\n{'='*60}")
    print("Basic Statistics")
    print(f"{'='*60}\n")
    
    print("Total Gas by Operation:")
    print(df.groupby('Operation')['TotalGas'].agg(['mean', 'min', 'max', 'std']))
    
    print("\n\nTotal Gas by Filter Complexity:")
    print(df.groupby('FilterComplexity')['TotalGas'].agg(['mean', 'min', 'max']))
    
    print("\n\nGas Phase Breakdown (averages):")
    print(f"  OpenJob:       {df['OpenJobGas'].mean():,.0f} gas ({df['OpenJobGas'].mean()/df['TotalGas'].mean()*100:.1f}%)")
    print(f"  PushRow Total: {df['PushRowTotal'].mean():,.0f} gas ({df['PushRowTotal'].mean()/df['TotalGas'].mean()*100:.1f}%)")
    print(f"  Finalize:      {df['FinalizeGas'].mean():,.0f} gas ({df['FinalizeGas'].mean()/df['TotalGas'].mean()*100:.1f}%)")
    print(f"  Total:         {df['TotalGas'].mean():,.0f} gas")

def build_regression_model(df, target='TotalGas', include_interaction=True):
    """Build linear regression model"""
    print(f"\n{'='*60}")
    print(f"Building Regression Model for {target}")
    if include_interaction:
        print("(with Rows × Columns interaction)")
    print(f"{'='*60}\n")
    
    # Prepare features
    X = df[['Rows', 'Columns', 'FilterBytes']].copy()
    
    # Add interaction term (key insight: decoding cost scales with rows × columns)
    if include_interaction:
        X['Rows_x_Columns'] = df['Rows'] * df['Columns']
    
    # Add operation dummy variables (COUNT is reference category)
    operation_dummies = pd.get_dummies(df['Operation'], prefix='Op')
    # Drop COUNT column to make it the explicit reference category
    operation_dummies = operation_dummies.drop('Op_COUNT', axis=1)
    X = pd.concat([X, operation_dummies], axis=1)
    
    y = df[target]
    
    # Fit model
    model = LinearRegression()
    model.fit(X, y)
    
    # Predictions and metrics
    y_pred = model.predict(X)
    r2 = r2_score(y, y_pred)
    mape = mean_absolute_percentage_error(y, y_pred) * 100
    
    print(f"Model Performance:")
    print(f"  R² Score:  {r2:.4f} ({r2*100:.1f}% variance explained)")
    print(f"  MAPE:      {mape:.2f}%")
    print(f"  Target:    R² ≥ 0.60, MAPE ≤ 40%")
    
    if r2 >= 0.60:
        print(f"  ✓ Model meets R² target!")
    else:
        print(f"  ✗ Model below R² target")
    
    if mape <= 40:
        print(f"  ✓ Model meets MAPE target!")
    else:
        print(f"  ✗ Model above MAPE target - consider more terms")
    
    # Print coefficients
    print(f"\nModel Coefficients:")
    print(f"  Intercept: {model.intercept_:,.0f} gas")
    
    coef_df = pd.DataFrame({
        'Feature': X.columns,
        'Coefficient': model.coef_,
        'Impact': model.coef_
    }).sort_values('Coefficient', ascending=False)
    
    print("\n" + coef_df.to_string(index=False))
    
    return model, X, y, y_pred, coef_df

def analyze_per_row_costs(df):
    """Analyze per-row costs by operation"""
    print(f"\n{'='*60}")
    print("Per-Row Cost Analysis")
    print(f"{'='*60}\n")
    
    print("Average gas per row by operation:")
    per_row = df.groupby('Operation')['PushRowAvg'].agg(['mean', 'std'])
    print(per_row)
    
    # Calculate relative costs (COUNT = baseline)
    baseline = per_row.loc['COUNT', 'mean']
    per_row['Relative'] = per_row['mean'] / baseline
    
    print("\nRelative to COUNT (1.0x):")
    print(per_row[['Relative']].sort_values('Relative', ascending=False))

def visualize_results(df, y_pred, coef_df):
    """Create visualization plots"""
    print(f"\n{'='*60}")
    print("Generating Visualizations")
    print(f"{'='*60}\n")
    
    fig, axes = plt.subplots(2, 2, figsize=(15, 12))
    
    # 1. Actual vs Predicted
    ax = axes[0, 0]
    ax.scatter(df['TotalGas'], y_pred, alpha=0.6)
    ax.plot([df['TotalGas'].min(), df['TotalGas'].max()], 
            [df['TotalGas'].min(), df['TotalGas'].max()], 
            'r--', lw=2)
    ax.set_xlabel('Actual Gas')
    ax.set_ylabel('Predicted Gas')
    ax.set_title('Actual vs Predicted Total Gas')
    ax.grid(True, alpha=0.3)
    
    # 2. Gas by Operation
    ax = axes[0, 1]
    df.boxplot(column='TotalGas', by='Operation', ax=ax)
    ax.set_xlabel('Operation')
    ax.set_ylabel('Total Gas')
    ax.set_title('Gas Distribution by Operation')
    plt.sca(ax)
    plt.xticks(rotation=45)
    
    # 3. Coefficient Importance
    ax = axes[1, 0]
    coef_plot = coef_df.head(10).copy()
    ax.barh(coef_plot['Feature'], coef_plot['Coefficient'])
    ax.set_xlabel('Coefficient (Gas Impact)')
    ax.set_title('Top 10 Feature Coefficients')
    ax.grid(True, alpha=0.3)
    
    # 4. Gas Scaling with Rows
    ax = axes[1, 1]
    for op in df['Operation'].unique():
        op_data = df[df['Operation'] == op]
        ax.scatter(op_data['Rows'], op_data['TotalGas'], label=op, alpha=0.6)
    ax.set_xlabel('Number of Rows')
    ax.set_ylabel('Total Gas')
    ax.set_title('Gas Scaling with Rows (by Operation)')
    ax.legend()
    ax.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig('gas_analysis.png', dpi=150)
    print("Saved visualization to: gas_analysis.png")

def generate_estimator_code(model, coef_df):
    """Generate TypeScript estimator function code"""
    print(f"\n{'='*60}")
    print("Gas Estimator Function (TypeScript)")
    print(f"{'='*60}\n")
    
    # Extract coefficients
    intercept = model.intercept_
    
    # Find row, column, filter coefficients
    row_coef = coef_df[coef_df['Feature'] == 'Rows']['Coefficient'].values[0] if 'Rows' in coef_df['Feature'].values else 0
    col_coef = coef_df[coef_df['Feature'] == 'Columns']['Coefficient'].values[0] if 'Columns' in coef_df['Feature'].values else 0
    filter_coef = coef_df[coef_df['Feature'] == 'FilterBytes']['Coefficient'].values[0] if 'FilterBytes' in coef_df['Feature'].values else 0
    
    # Check for interaction term
    interaction_coef = 0
    has_interaction = 'Rows_x_Columns' in coef_df['Feature'].values
    if has_interaction:
        interaction_coef = coef_df[coef_df['Feature'] == 'Rows_x_Columns']['Coefficient'].values[0]
    
    # Extract operation coefficients
    op_coefs = {}
    for _, row in coef_df.iterrows():
        if row['Feature'].startswith('Op_'):
            op_name = row['Feature'].replace('Op_', '')
            op_coefs[op_name] = row['Coefficient']
    
    # Generate code with or without interaction
    if has_interaction:
        code = f"""
/**
 * Estimates gas cost for a JobManager job based on parameters
 * 
 * Model Accuracy: See analysis output for R² and MAPE
 * Model includes Rows × Columns interaction term for better accuracy
 * 
 * @param rows Number of rows in dataset
 * @param columns Number of columns in dataset
 * @param operation Operation type
 * @param filterBytes Approximate filter bytecode length
 * @returns Estimated total gas cost
 */
function estimateJobGas(
  rows: number,
  columns: number,
  operation: 'COUNT' | 'SUM' | 'AVG_P' | 'WEIGHTED_SUM' | 'MIN' | 'MAX',
  filterBytes: number
): number {{
  // Base cost (intercept)
  let gas = {intercept:.0f};
  
  // Add per-row cost
  gas += rows * {row_coef:.0f};
  
  // Add per-column cost
  gas += columns * {col_coef:.0f};
  
  // Add row × column interaction (decoding cost scales with both)
  gas += (rows * columns) * {interaction_coef:.0f};
  
  // Add filter complexity cost
  gas += filterBytes * {filter_coef:.0f};
  
  // Add operation-specific costs (relative to COUNT baseline)
  const operationCosts = {{
    'COUNT': 0,  // baseline
    'SUM': {op_coefs.get('SUM', 0):.0f},
    'AVG_P': {op_coefs.get('AVG_P', 0):.0f},
    'WEIGHTED_SUM': {op_coefs.get('WEIGHTED_SUM', 0):.0f},
    'MIN': {op_coefs.get('MIN', 0):.0f},
    'MAX': {op_coefs.get('MAX', 0):.0f},
  }};
  
  gas += operationCosts[operation];
  
  return Math.round(gas);
}}

// Example usage:
const estimatedGas = estimateJobGas(50, 15, 'SUM', 7);
console.log(`Estimated gas: ${{estimatedGas.toLocaleString()}}`);
"""
    else:
        code = f"""
/**
 * Estimates gas cost for a JobManager job based on parameters
 * 
 * Model Accuracy: See analysis output for R² and MAPE
 * 
 * @param rows Number of rows in dataset
 * @param columns Number of columns in dataset
 * @param operation Operation type
 * @param filterBytes Approximate filter bytecode length
 * @returns Estimated total gas cost
 */
function estimateJobGas(
  rows: number,
  columns: number,
  operation: 'COUNT' | 'SUM' | 'AVG_P' | 'WEIGHTED_SUM' | 'MIN' | 'MAX',
  filterBytes: number
): number {{
  // Base cost (intercept)
  let gas = {intercept:.0f};
  
  // Add per-row cost
  gas += rows * {row_coef:.0f};
  
  // Add per-column cost (decoding)
  gas += columns * {col_coef:.0f};
  
  // Add filter complexity cost
  gas += filterBytes * {filter_coef:.0f};
  
  // Add operation-specific costs (relative to COUNT baseline)
  const operationCosts = {{
    'COUNT': 0,  // baseline
    'SUM': {op_coefs.get('SUM', 0):.0f},
    'AVG_P': {op_coefs.get('AVG_P', 0):.0f},
    'WEIGHTED_SUM': {op_coefs.get('WEIGHTED_SUM', 0):.0f},
    'MIN': {op_coefs.get('MIN', 0):.0f},
    'MAX': {op_coefs.get('MAX', 0):.0f},
  }};
  
  gas += operationCosts[operation];
  
  return Math.round(gas);
}}

// Example usage:
const estimatedGas = estimateJobGas(50, 15, 'SUM', 7);
console.log(`Estimated gas: ${{estimatedGas.toLocaleString()}}`);
"""
    
    print(code)
    
    # Save to file
    with open('estimateJobGas.ts', 'w') as f:
        f.write(code)
    print("\nSaved estimator function to: estimateJobGas.ts")

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_gas_results.py <csv_file>")
        print("\nExample: python analyze_gas_results.py gas_benchmark_results.csv")
        sys.exit(1)
    
    csv_path = sys.argv[1]
    
    try:
        # Load data
        df = load_and_prepare_data(csv_path)
        
        # Basic statistics
        analyze_basic_statistics(df)
        
        # Per-row analysis
        analyze_per_row_costs(df)
        
        # Build regression model
        model, X, y, y_pred, coef_df = build_regression_model(df, 'TotalGas')
        
        # Optionally analyze per-phase costs
        print("\n\n--- Analyzing PushRow Costs ---")
        build_regression_model(df, 'PushRowTotal')
        
        # Generate visualizations
        visualize_results(df, y_pred, coef_df)
        
        # Generate estimator code
        generate_estimator_code(model, coef_df)
        
        print(f"\n{'='*60}")
        print("Analysis Complete!")
        print(f"{'='*60}\n")
        print("Generated files:")
        print("  - gas_analysis.png (visualizations)")
        print("  - estimateJobGas.ts (estimator function)")
        print("\nNext steps:")
        print("  1. Review R² score (target: ≥0.60)")
        print("  2. Check MAPE (target: ≤40%)")
        print("  3. Use estimateJobGas.ts in your application")
        print("  4. Validate with holdout test cases")
        
    except FileNotFoundError:
        print(f"Error: File '{csv_path}' not found")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

