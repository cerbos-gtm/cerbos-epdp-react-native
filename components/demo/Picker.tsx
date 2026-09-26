import { StyleSheet } from "react-native";
import SelectDropdown from "react-native-select-dropdown";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";

interface PickerProps<T extends { id?: string }> {
  label: string;
  items: T[];
  selected: T;
  onSelect: (item: T) => void;
}

/** A dropdown of demo principals or resources, showing the selected one as JSON. */
export function Picker<T extends { id?: string }>({
  label,
  items,
  selected,
  onSelect,
}: PickerProps<T>) {
  return (
    <ThemedView style={styles.column}>
      <ThemedText>{label}</ThemedText>
      <SelectDropdown
        data={items}
        defaultValue={selected}
        onSelect={onSelect}
        renderButton={(item?: T) => (
          <ThemedView style={styles.button}>
            <ThemedText style={styles.buttonText}>
              {item?.id ?? `Select ${label.toLowerCase()}`}
            </ThemedText>
          </ThemedView>
        )}
        renderItem={(item: T, _, isSelected) => (
          <ThemedView style={[styles.item, isSelected && styles.selectedItem]}>
            <ThemedText style={styles.itemText}>{item.id}</ThemedText>
          </ThemedView>
        )}
        showsVerticalScrollIndicator={false}
        dropdownStyle={styles.menu}
      />
      <ThemedText style={styles.json}>
        {JSON.stringify(selected, null, 2)}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
  },
  button: {
    width: 175,
    height: 50,
    backgroundColor: "#E9ECEF",
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "500",
    color: "#151E26",
  },
  menu: {
    backgroundColor: "#E9ECEF",
    borderRadius: 8,
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectedItem: {
    backgroundColor: "#D2D9DF",
  },
  itemText: {
    fontSize: 18,
    fontWeight: "500",
    color: "#151E26",
  },
  json: {
    fontSize: 12,
    lineHeight: 16,
    padding: 8,
  },
});
