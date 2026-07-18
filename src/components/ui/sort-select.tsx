"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

type SortOption<TValue extends string> = {
  value: TValue;
  label: string;
};

export function SortSelect<TValue extends string>({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: readonly SortOption<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
}) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <div className="catalog-sort-control">
      <span>{label}</span>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger className="catalog-select-trigger" type="button" aria-label={label}>
          <span>{selectedOption?.label ?? value}</span>
          <span className="control-chevron" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="control-menu" align="end" sideOffset={6}>
            <DropdownMenu.RadioGroup
              className="control-menu-options"
              value={value}
              onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
            >
              {options.map((option) => (
                <DropdownMenu.RadioItem className="control-menu-option" value={option.value} key={option.value}>
                  {option.label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
