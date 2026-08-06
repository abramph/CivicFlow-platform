import type { WhatsAppTemplate } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface WhatsAppTemplateVariable {
  name: string;
  required: boolean;
  maxLength?: number;
}

function parseVariablesSchema(template: WhatsAppTemplate): WhatsAppTemplateVariable[] {
  const schema = template.variablesSchema;
  if (!Array.isArray(schema)) return [];
  const entries: WhatsAppTemplateVariable[] = [];
  for (const entry of schema) {
    if (typeof entry === "object" && entry !== null && typeof (entry as { name?: unknown }).name === "string") {
      entries.push(entry as unknown as WhatsAppTemplateVariable);
    }
  }
  return entries;
}

/**
 * Resolves an active, approved template by its internal key — the only way
 * a send should ever pick a template (never by raw Content SID from a
 * caller). Returns null for a missing, inactive, or not-yet-approved
 * template so callers fail closed rather than sending an unapproved body.
 */
export async function getActiveTemplate(key: string): Promise<WhatsAppTemplate | null> {
  const template = await prisma.whatsAppTemplate.findUnique({ where: { key } });
  if (!template || !template.active || template.approvalStatus !== "APPROVED") return null;
  return template;
}

/**
 * Validates a caller-supplied variables map against a template's schema
 * before every send — required fields present, no field over its
 * maxLength. Never allows an unlisted variable through silently; extra keys
 * are dropped from the returned, validated map rather than passed on.
 */
export function validateTemplateVariables(
  template: WhatsAppTemplate,
  variables: Record<string, string>
): { valid: true; variables: Record<string, string> } | { valid: false; reason: string } {
  const schema = parseVariablesSchema(template);
  const validated: Record<string, string> = {};

  for (const field of schema) {
    const value = variables[field.name];
    if (field.required && (value === undefined || value === "")) {
      return { valid: false, reason: `Missing required template variable "${field.name}".` };
    }
    if (value === undefined) continue;
    if (field.maxLength && value.length > field.maxLength) {
      return { valid: false, reason: `Template variable "${field.name}" exceeds its maximum length.` };
    }
    validated[field.name] = value;
  }

  return { valid: true, variables: validated };
}
