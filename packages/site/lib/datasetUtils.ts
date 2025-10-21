import { ethers } from "ethers";

export interface ParsedDataset {
  rows: any[][];
  numColumns: number;
  rowCount: number;
}

/**
 * Parse CSV content into a 2D array
 */
export function parseCSV(csvContent: string): any[][] {
  const lines = csvContent.trim().split("\n");
  return lines.map((line) => {
    // Simple CSV parser - handles basic cases
    return line.split(",").map((cell) => cell.trim());
  });
}

/**
 * Parse JSON content into a 2D array
 * Expects either:
 * - Array of arrays: [[1,2,3], [4,5,6]]
 * - Array of objects: [{a:1, b:2}, {a:3, b:4}]
 */
export function parseJSON(jsonContent: string): any[][] {
  const data = JSON.parse(jsonContent);

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("JSON must be a non-empty array");
  }

  // If array of objects, convert to array of arrays
  if (typeof data[0] === "object" && !Array.isArray(data[0])) {
    const keys = Object.keys(data[0]);
    return data.map((obj) => keys.map((key) => obj[key]));
  }

  // If array of arrays, return as-is
  if (Array.isArray(data[0])) {
    return data;
  }

  throw new Error("Invalid JSON format");
}

/**
 * Process uploaded file and return dataset metadata
 */
export async function processDatasetFile(file: File): Promise<ParsedDataset> {
  const content = await file.text();
  const fileType = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";

  let rows: any[][];

  if (fileType === "json") {
    rows = parseJSON(content);
  } else {
    rows = parseCSV(content).splice(1); // Skip header row
  }

  if (rows.length === 0) {
    throw new Error("Dataset must have at least one row");
  }

  const numColumns = rows[0].length;

  // Validate all rows have same number of columns
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== numColumns) {
      throw new Error(
        `Row ${i + 1} has ${rows[i].length} columns, expected ${numColumns}`
      );
    }
  }

  const rowCount = rows.length;

  return {
    rows,
    numColumns,
    rowCount,
  };
}

/**
 * LocalStorage utilities for encrypted datasets
 */
const STORAGE_KEY_PREFIX = "encrypted-dataset-";

export function saveEncryptedDatasetToStorage(dataset: any): void {
  const key = `${STORAGE_KEY_PREFIX}${dataset.datasetId}`;
  localStorage.setItem(key, JSON.stringify(dataset));
}

export function loadEncryptedDatasetFromStorage(datasetId: string): any | null {
  const key = `${STORAGE_KEY_PREFIX}${datasetId}`;
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : null;
}

export function clearEncryptedDatasetFromStorage(datasetId: string): void {
  const key = `${STORAGE_KEY_PREFIX}${datasetId}`;
  localStorage.removeItem(key);
}
