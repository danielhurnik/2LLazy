/**
 * snapshotFormFields
 *
 * Injects `data-aaf-idx` attributes onto every visible, non-disabled
 * form field on the current page and serialises their descriptors.
 *
 * This snapshot is what the deterministic fill-plan mapper reads.
 */
import type { Page } from "playwright";

export interface FieldSnapshot {
  idx: number;
  tag: "input" | "textarea" | "select" | "button";
  type: string;
  id: string;
  name: string;
  placeholder: string;
  ariaLabel: string;
  labelText: string;
  currentValue: string;
  isRequired: boolean;
}

export async function snapshotFormFields(page: Page): Promise<FieldSnapshot[]> {
  return page.evaluate((): FieldSnapshot[] => {
    const SELECTOR = "input:not([type=hidden]):not([type=password]), textarea, select, button[type=submit]";

    const fields = Array.from(document.querySelectorAll(SELECTOR)) as (
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | HTMLButtonElement
    )[];

    return fields
      .filter((el) => {
        if ((el as HTMLInputElement).disabled) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el, idx) => {
        el.setAttribute("data-aaf-idx", String(idx));

        // Find associated <label> text
        let labelText = "";
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label) labelText = (label.textContent ?? "").trim();
        }
        if (!labelText) {
          const closest = el.closest("label");
          if (closest) labelText = (closest.textContent ?? "").trim().slice(0, 100);
        }

        return {
          idx,
          tag: el.tagName.toLowerCase() as FieldSnapshot["tag"],
          type: el.getAttribute("type") ?? "",
          id: el.id ?? "",
          name: (el as HTMLInputElement).name ?? "",
          placeholder: (el as HTMLInputElement).placeholder ?? "",
          ariaLabel: el.getAttribute("aria-label") ?? "",
          labelText: labelText.slice(0, 120),
          currentValue: ("value" in el ? (el as HTMLInputElement).value : "") ?? "",
          isRequired: el.hasAttribute("required"),
        };
      });
  });
}
