/* eslint-disable */
// GENERATED FILE. Run scripts/generate-miniprogram-contract.ts; do not edit.
export const WORKSPACE_CONTRACT_VERSION = 1 as const;

export type AccountSummary = { "contractVersion": 1; "displayName": string; "maskedEmail": string; };

export type StorySummary = { "contractVersion": 1; "id": number; "title": string; "updatedAt": number; };

export type StoryCreateRequest = { "contractVersion": 1; "clientOperationId": string; "title": string; };

export type StoryCreateReceipt = { "contractVersion": 1; "clientOperationId": string; "requestHash": string; "status": "complete"; "story": StorySummary; };

export type StoryCreateResponse = { "contractVersion": 1; "receipt": StoryCreateReceipt; "document": DocumentRead; };

export type SubmitTurnRequest = { "contractVersion": 1; "storyId": number; "clientTurnId": string; "requestHash": string; "userClientMessageId": string; "assistantClientMessageId": string; "userContent": string; };

export type TurnStatusRequest = { "contractVersion": 1; "storyId": number; "clientTurnId": string; "requestHash": string; };

export type TurnStatus = { "contractVersion": 1; "clientTurnId": string; "status": "processing" | "unknown" | "synced" | "failed" | "rejected"; "assistantContent": string | null; "settledCostMinor": number | null; };

export type TurnReceipt = { "contractVersion": 1; "clientTurnId": string; "requestHash": string; "status": "processing" | "unknown" | "synced" | "failed" | "rejected"; "settledCostMinor": number | null; };

export type TurnSubmitResponse = { "contractVersion": 1; "turn": TurnStatus; "receipt": TurnReceipt; "balance": BalanceSummary; };

export type TurnStatusResponse = { "contractVersion": 1; "turn": TurnStatus; "receipt": TurnReceipt; "balance": BalanceSummary; };

export type DocumentRead = { "contractVersion": 1; "storyId": number; "storyRevision": number; "versionId": string; "platform": "xiaohongshu" | "x" | "instagram" | "linkedin" | "wechat_moments" | "douyin_tiktok"; "body": string; "bodyRevision": number; "updatedAt": number; };

export type DocumentSaveRequest = { "contractVersion": 1; "storyId": number; "versionId": string; "platform": "xiaohongshu" | "x" | "instagram" | "linkedin" | "wechat_moments" | "douyin_tiktok"; "baseBodyRevision": number; "body": string; };

export type DocumentConflict = { "contractVersion": 1; "kind": "document-conflict"; "latest": DocumentRead; };

export type DocumentSaveResponse = { "contractVersion": 1; "document": DocumentRead; };

export type BalanceSummary = { "contractVersion": 1; "currency": "CNY"; "minorPerMajor": 1000000; "ledgerMinor": number; "reservedMinor": number; "availableMinor": number; "lastSettledCostMinor": number | null; };

export type RecentCharge = { "contractVersion": 1; "ledgerEntryId": string; "storyId": number; "clientTurnId": string | null; "receiptId": string | null; "amountMinor": number; "currency": "CNY"; "minorPerMajor": 1000000; "settledAt": number; "label": string; };

export type ConversationMessage = { "contractVersion": 1; "id": number; "role": "user" | "assistant" | "system"; "content": string; "clientMessageId": string | null; "createdAt": string; };

export type WorkspaceSnapshot = { "contractVersion": 1; "story": StorySummary; "messages": Array<ConversationMessage>; "document": DocumentRead; "balance": BalanceSummary; "recentCharges": Array<RecentCharge>; };

export type WorkspaceErrorKind = "explicit-failure" | "unknown-result" | "unauthorized" | "identity-conflict" | "target-missing" | "document-conflict" | "insufficient-balance" | "content-rejected" | "unavailable";

export type WorkspaceError = { "contractVersion": 1; "kind": WorkspaceErrorKind; "message": string; "retryable": boolean; "resultUnknown": boolean; };

export type WorkspaceErrorEnvelope = { "contractVersion": 1; "ok": false; "error": WorkspaceError; };

export type WorkspaceContractName = "AccountSummary" | "StorySummary" | "StoryCreateRequest" | "StoryCreateReceipt" | "StoryCreateResponse" | "SubmitTurnRequest" | "TurnStatusRequest" | "TurnStatus" | "TurnReceipt" | "TurnSubmitResponse" | "TurnStatusResponse" | "DocumentRead" | "DocumentSaveRequest" | "DocumentConflict" | "DocumentSaveResponse" | "BalanceSummary" | "RecentCharge" | "ConversationMessage" | "WorkspaceSnapshot" | "WorkspaceErrorKind" | "WorkspaceError" | "WorkspaceErrorEnvelope";
export type ContractValidation = { ok: true } | { ok: false; issues: string[] };

type RuntimeSchema = {
  $ref?: string; const?: unknown; enum?: unknown[]; type?: string | string[];
  properties?: Record<string, RuntimeSchema>; required?: string[]; additionalProperties?: boolean;
  items?: RuntimeSchema; minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number;
};
const DEFINITIONS: Record<string, RuntimeSchema> = {
  "AccountSummary": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "displayName",
      "maskedEmail"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "displayName": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "maskedEmail": {
        "type": "string",
        "minLength": 3,
        "maxLength": 254
      }
    }
  },
  "StorySummary": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "id",
      "title",
      "updatedAt"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "id": {
        "type": "integer",
        "minimum": 1
      },
      "title": {
        "type": "string",
        "maxLength": 200
      },
      "updatedAt": {
        "type": "integer",
        "minimum": 0
      }
    }
  },
  "StoryCreateRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "clientOperationId",
      "title"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "clientOperationId": {
        "type": "string",
        "minLength": 8,
        "maxLength": 80,
        "pattern": "^[A-Za-z0-9_-]+$"
      },
      "title": {
        "type": "string",
        "maxLength": 200
      }
    }
  },
  "StoryCreateReceipt": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "clientOperationId",
      "requestHash",
      "status",
      "story"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "clientOperationId": {
        "type": "string",
        "minLength": 8,
        "maxLength": 80
      },
      "requestHash": {
        "type": "string",
        "pattern": "^scr1-[a-f0-9]{32}$"
      },
      "status": {
        "const": "complete"
      },
      "story": {
        "$ref": "#/$defs/StorySummary"
      }
    }
  },
  "StoryCreateResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "receipt",
      "document"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "receipt": {
        "$ref": "#/$defs/StoryCreateReceipt"
      },
      "document": {
        "$ref": "#/$defs/DocumentRead"
      }
    }
  },
  "SubmitTurnRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "storyId",
      "clientTurnId",
      "requestHash",
      "userClientMessageId",
      "assistantClientMessageId",
      "userContent"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "storyId": {
        "type": "integer",
        "minimum": 1
      },
      "clientTurnId": {
        "type": "string",
        "minLength": 8,
        "maxLength": 80
      },
      "requestHash": {
        "type": "string",
        "pattern": "^sct1-[a-f0-9]{32}$"
      },
      "userClientMessageId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "assistantClientMessageId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "userContent": {
        "type": "string",
        "minLength": 1,
        "maxLength": 20000
      }
    }
  },
  "TurnStatusRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "storyId",
      "clientTurnId",
      "requestHash"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "storyId": {
        "type": "integer",
        "minimum": 1
      },
      "clientTurnId": {
        "type": "string",
        "minLength": 8,
        "maxLength": 80
      },
      "requestHash": {
        "type": "string",
        "pattern": "^sct1-[a-f0-9]{32}$"
      }
    }
  },
  "TurnStatus": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "clientTurnId",
      "status",
      "assistantContent",
      "settledCostMinor"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "clientTurnId": {
        "type": "string",
        "minLength": 8,
        "maxLength": 80
      },
      "status": {
        "enum": [
          "processing",
          "unknown",
          "synced",
          "failed",
          "rejected"
        ]
      },
      "assistantContent": {
        "type": [
          "string",
          "null"
        ],
        "maxLength": 100000
      },
      "settledCostMinor": {
        "type": [
          "integer",
          "null"
        ],
        "minimum": 0
      }
    }
  },
  "TurnReceipt": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "clientTurnId",
      "requestHash",
      "status",
      "settledCostMinor"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "clientTurnId": {
        "type": "string",
        "minLength": 8,
        "maxLength": 80
      },
      "requestHash": {
        "type": "string",
        "pattern": "^sct1-[a-f0-9]{32}$"
      },
      "status": {
        "enum": [
          "processing",
          "unknown",
          "synced",
          "failed",
          "rejected"
        ]
      },
      "settledCostMinor": {
        "type": [
          "integer",
          "null"
        ],
        "minimum": 0
      }
    }
  },
  "TurnSubmitResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "turn",
      "receipt",
      "balance"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "turn": {
        "$ref": "#/$defs/TurnStatus"
      },
      "receipt": {
        "$ref": "#/$defs/TurnReceipt"
      },
      "balance": {
        "$ref": "#/$defs/BalanceSummary"
      }
    }
  },
  "TurnStatusResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "turn",
      "receipt",
      "balance"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "turn": {
        "$ref": "#/$defs/TurnStatus"
      },
      "receipt": {
        "$ref": "#/$defs/TurnReceipt"
      },
      "balance": {
        "$ref": "#/$defs/BalanceSummary"
      }
    }
  },
  "DocumentRead": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "storyId",
      "storyRevision",
      "versionId",
      "platform",
      "body",
      "bodyRevision",
      "updatedAt"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "storyId": {
        "type": "integer",
        "minimum": 1
      },
      "storyRevision": {
        "type": "integer",
        "minimum": 1
      },
      "versionId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "platform": {
        "enum": [
          "xiaohongshu",
          "x",
          "instagram",
          "linkedin",
          "wechat_moments",
          "douyin_tiktok"
        ]
      },
      "body": {
        "type": "string",
        "maxLength": 500000
      },
      "bodyRevision": {
        "type": "integer",
        "minimum": 1
      },
      "updatedAt": {
        "type": "integer",
        "minimum": 0
      }
    }
  },
  "DocumentSaveRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "storyId",
      "versionId",
      "platform",
      "baseBodyRevision",
      "body"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "storyId": {
        "type": "integer",
        "minimum": 1
      },
      "versionId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "platform": {
        "enum": [
          "xiaohongshu",
          "x",
          "instagram",
          "linkedin",
          "wechat_moments",
          "douyin_tiktok"
        ]
      },
      "baseBodyRevision": {
        "type": "integer",
        "minimum": 1
      },
      "body": {
        "type": "string",
        "maxLength": 500000
      }
    }
  },
  "DocumentConflict": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "kind",
      "latest"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "kind": {
        "const": "document-conflict"
      },
      "latest": {
        "$ref": "#/$defs/DocumentRead"
      }
    }
  },
  "DocumentSaveResponse": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "document"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "document": {
        "$ref": "#/$defs/DocumentRead"
      }
    }
  },
  "BalanceSummary": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "currency",
      "minorPerMajor",
      "ledgerMinor",
      "reservedMinor",
      "availableMinor",
      "lastSettledCostMinor"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "currency": {
        "const": "CNY"
      },
      "minorPerMajor": {
        "const": 1000000
      },
      "ledgerMinor": {
        "type": "integer",
        "minimum": 0
      },
      "reservedMinor": {
        "type": "integer",
        "minimum": 0
      },
      "availableMinor": {
        "type": "integer",
        "minimum": 0
      },
      "lastSettledCostMinor": {
        "type": [
          "integer",
          "null"
        ],
        "minimum": 0
      }
    }
  },
  "RecentCharge": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "ledgerEntryId",
      "storyId",
      "clientTurnId",
      "receiptId",
      "amountMinor",
      "currency",
      "minorPerMajor",
      "settledAt",
      "label"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "ledgerEntryId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "storyId": {
        "type": "integer",
        "minimum": 1
      },
      "clientTurnId": {
        "type": [
          "string",
          "null"
        ],
        "maxLength": 80
      },
      "receiptId": {
        "type": [
          "string",
          "null"
        ],
        "maxLength": 80
      },
      "amountMinor": {
        "type": "integer",
        "minimum": 0
      },
      "currency": {
        "const": "CNY"
      },
      "minorPerMajor": {
        "const": 1000000
      },
      "settledAt": {
        "type": "integer",
        "minimum": 0
      },
      "label": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      }
    }
  },
  "ConversationMessage": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "id",
      "role",
      "content",
      "clientMessageId",
      "createdAt"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "id": {
        "type": "integer",
        "minimum": 1
      },
      "role": {
        "enum": [
          "user",
          "assistant",
          "system"
        ]
      },
      "content": {
        "type": "string",
        "maxLength": 100000
      },
      "clientMessageId": {
        "type": [
          "string",
          "null"
        ],
        "maxLength": 100
      },
      "createdAt": {
        "type": "string",
        "minLength": 1,
        "maxLength": 40
      }
    }
  },
  "WorkspaceSnapshot": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "story",
      "messages",
      "document",
      "balance",
      "recentCharges"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "story": {
        "$ref": "#/$defs/StorySummary"
      },
      "messages": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/ConversationMessage"
        }
      },
      "document": {
        "$ref": "#/$defs/DocumentRead"
      },
      "balance": {
        "$ref": "#/$defs/BalanceSummary"
      },
      "recentCharges": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/RecentCharge"
        }
      }
    }
  },
  "WorkspaceErrorKind": {
    "enum": [
      "explicit-failure",
      "unknown-result",
      "unauthorized",
      "identity-conflict",
      "target-missing",
      "document-conflict",
      "insufficient-balance",
      "content-rejected",
      "unavailable"
    ]
  },
  "WorkspaceError": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "kind",
      "message",
      "retryable",
      "resultUnknown"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "kind": {
        "$ref": "#/$defs/WorkspaceErrorKind"
      },
      "message": {
        "type": "string",
        "minLength": 1,
        "maxLength": 500
      },
      "retryable": {
        "type": "boolean"
      },
      "resultUnknown": {
        "type": "boolean"
      }
    }
  },
  "WorkspaceErrorEnvelope": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "contractVersion",
      "ok",
      "error"
    ],
    "properties": {
      "contractVersion": {
        "const": 1
      },
      "ok": {
        "const": false
      },
      "error": {
        "$ref": "#/$defs/WorkspaceError"
      }
    }
  }
};

function validateNode(schema: RuntimeSchema, value: unknown, at: string, issues: string[]): void {
  if (schema.$ref) {
    const target = DEFINITIONS[schema.$ref.split("/").pop() || ""];
    if (!target) { issues.push(at + ": unknown schema reference"); return; }
    validateNode(target, value, at, issues); return;
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) issues.push(at + ": unexpected constant");
  if (schema.enum && !schema.enum.includes(value)) issues.push(at + ": value is not in enum");
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "integer" ? Number.isInteger(value) : type === "object" ? typeof value === "object" && value !== null && !Array.isArray(value) : typeof value === type)) {
    issues.push(at + ": wrong type"); return;
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(at + ": too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(at + ": too long");
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) issues.push(at + ": pattern mismatch");
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(at + ": below minimum");
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(at + ": above maximum");
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => validateNode(schema.items!, item, at + "[" + index + "]", issues));
  if (schema.type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>; const properties = schema.properties || {};
    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(record, key)) issues.push(at + "." + key + ": required");
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) { if (schema.additionalProperties === false) issues.push(at + "." + key + ": unknown field"); }
      else validateNode(properties[key], record[key], at + "." + key, issues);
    }
  }
}

export function validateWorkspaceContract(name: string, value: unknown): ContractValidation {
  const schema = DEFINITIONS[name];
  if (!schema) return { ok: false, issues: ["$: unknown contract " + name] };
  const issues: string[] = []; validateNode(schema, value, "$", issues);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
