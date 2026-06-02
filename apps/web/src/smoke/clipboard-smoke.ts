import { writeClipboardText } from "../shared/clipboard";

const clipboardWrites: string[] = [];
const selectedValues: string[] = [];

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    clipboard: {
      writeText: async (text: string): Promise<void> => {
        clipboardWrites.push(text);
        throw new Error("Clipboard permission denied");
      }
    }
  }
});

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    body: {
      append: (element: { value: string }): void => {
        selectedValues.push(element.value);
      }
    },
    createElement: (): {
      readOnly: boolean;
      remove: () => void;
      select: () => void;
      style: Record<string, string>;
      value: string;
    } => ({
      readOnly: false,
      remove: () => undefined,
      select: () => undefined,
      style: {},
      value: ""
    }),
    execCommand: (command: string): boolean => command === "copy"
  }
});

await writeClipboardText("prompt from gallery or video library");

expect(clipboardWrites.length === 1, "modern clipboard API is attempted first");
expect(selectedValues.includes("prompt from gallery or video library"), "copy falls back to textarea when modern clipboard fails");

console.log("clipboard smoke checks passed");

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
