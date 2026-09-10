import { randomUUID } from "node:crypto";
export const password = "synthetic-studio-test-password";
export const sample = (overrides = {}) => ({
  name: "Neighbourhood repair desk",
  client: "Fictional Common Ground workshop",
  author: "Independent developer",
  summary:
    "Replace scattered paper repair requests with a searchable intake queue and a simple status workflow.",
  currency: "NGN",
  discount: "25.00",
  taxRate: "7.50",
  lines: [
    {
      id: randomUUID(),
      description:
        "Map the intake workflow and define a testable release scope.",
      quantity: "2.50",
      unit: "hour",
      rate: "125.50",
    },
    {
      id: randomUUID(),
      description: "Build and test the repair intake prototype.",
      quantity: "1.00",
      unit: "milestone",
      rate: "800.00",
    },
  ],
  assumptions:
    "The workshop provides its status vocabulary and one reviewer for feedback.",
  exclusions:
    "Payments, public accounts and automated messages are not included.",
  terms:
    "Two review rounds. Proposed milestones and payment terms require a separate agreement.",
  ...overrides,
});
export const request = (type, data = {}) => ({
  type,
  requestId: randomUUID(),
  ...data,
});
