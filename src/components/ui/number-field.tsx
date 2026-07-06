"use client";

type NumberFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  inputMode?: "numeric" | "decimal";
  placeholder?: string;
  required?: boolean;
};

function sanitizeNumberInput(value: string, inputMode: "numeric" | "decimal") {
  if (inputMode === "numeric") {
    return value.replace(/\D/g, "");
  }

  const normalized = value.replace(/[^\d.]/g, "");
  const [wholePart, ...decimalParts] = normalized.split(".");
  return decimalParts.length > 0 ? `${wholePart}.${decimalParts.join("")}` : wholePart;
}

export function NumberField({
  value,
  onValueChange,
  inputMode = "numeric",
  placeholder,
  required,
}: NumberFieldProps) {
  return (
    <input
      className="number-field"
      type="text"
      inputMode={inputMode}
      value={value}
      onChange={(event) => onValueChange(sanitizeNumberInput(event.target.value, inputMode))}
      placeholder={placeholder}
      required={required}
    />
  );
}
