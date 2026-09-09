import SelectDropdown from "react-native-select-dropdown";
import { ThemedView } from "./ThemedView";
import { resources } from "@/constants/data";
import type { Resource } from "@cerbos/core";
import { ThemedText } from "./ThemedText";
import { StyleSheet } from "react-native";

interface ResourcePickerProps {
  resource: Resource;
  setResource: (resource: Resource) => void;
}

export function ResourcePicker({ resource, setResource }: ResourcePickerProps) {
  return (
    <ThemedView style={styles.dropdownColumn}>
      <ThemedText>Resource</ThemedText>
      <SelectDropdown
        data={resources.map((p) => ({ title: p.id, value: p }))}
        defaultValue={{ title: resource.id, value: resource }}
        onSelect={(selectedItem) => setResource(selectedItem.value)}
        renderButton={(selectedItem) => (
          <ThemedView style={styles.dropdownButtonStyle}>
            <ThemedText style={styles.dropdownButtonTxtStyle}>
              {(selectedItem && selectedItem.title) || "Select resource"}
            </ThemedText>
          </ThemedView>
        )}
        renderItem={(item, _, isSelected) => (
          <ThemedView
            style={{
              ...styles.dropdownItemStyle,
              ...(isSelected && { backgroundColor: "#D2D9DF" }),
            }}
          >
            <ThemedText style={styles.dropdownItemTxtStyle}>
              {item.title}
            </ThemedText>
          </ThemedView>
        )}
        showsVerticalScrollIndicator={false}
        dropdownStyle={styles.dropdownMenuStyle}
      />
      <ThemedText style={styles.jsonText}>
        {JSON.stringify(resource, null, 2)}
      </ThemedText>
    </ThemedView>
  );
}

// Styles for the component
const styles = StyleSheet.create({
  dropdownColumn: {
    flex: 1,
    flexDirection: "column",
  },
  dropdownButtonStyle: {
    width: 175,
    height: 50,
    backgroundColor: "#E9ECEF",
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  dropdownButtonTxtStyle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "500",
    color: "#151E26",
  },
  dropdownMenuStyle: {
    backgroundColor: "#E9ECEF",
    borderRadius: 8,
  },
  dropdownItemStyle: {
    width: "100%",
    flexDirection: "row",
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
  },
  dropdownItemTxtStyle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "500",
    color: "#151E26",
  },
  jsonText: {
    fontSize: 12,
    lineHeight: 16,
    padding: 8,
  },
});
