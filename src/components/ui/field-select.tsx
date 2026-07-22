"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

type FieldSelectOption<TValue extends string> = {
  value: TValue;
  label: string;
};

export function FieldSelect<TValue extends string>({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: readonly FieldSelectOption<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
}) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger className="field-select-trigger" type="button" aria-label={label}>
        <span>{selectedOption?.label ?? value}</span>
        <span className="control-chevron" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="field-select-menu" align="start" sideOffset={6}>
          <DropdownMenu.RadioGroup
            className="control-menu-options"
            value={value}
            onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
          >
            {options.map((option) => (
              <DropdownMenu.RadioItem className="field-select-option" value={option.value} key={option.value}>
                {option.label}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
