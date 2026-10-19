import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { Alert, Text, TextInput, TouchableOpacity } from "react-native";
import renderer, { act } from "react-test-renderer";

import AddContactScreen from "../app/add-contact";
import EditContactScreen from "../app/edit-contact";
import { getContacts } from "../services/contacts";

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ id: "contact-id" }),
}));

jest.mock("../src/theme/ThemeContext", () => ({
  useTheme: () => ({ theme: jest.requireActual("../src/theme/tokens").LightTheme }),
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("@react-native-community/netinfo", () => ({
  fetch: jest.fn(async () => ({ isConnected: false })),
}));

jest.mock("../services/supabase", () => ({ supabase: null }));

jest.mock("expo-crypto", () => ({ randomUUID: () => "contact-id" }));

// A checksum-valid Stellar Ed25519 public key; the validator is not mocked.
const PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("contact screens", () => {
  let tree: renderer.ReactTestRenderer | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(async () => {
    await act(async () => tree?.unmount());
    tree = undefined;
    jest.restoreAllMocks();
  });

  async function renderScreen(screen: React.ReactElement) {
    await act(async () => {
      tree = renderer.create(screen);
    });
  }

  function addressInput() {
    return tree!.root.findAllByType(TextInput).find(
      (input) => input.props.autoCorrect === false,
    )!;
  }

  async function saveAddress(address: string) {
    await renderScreen(<AddContactScreen />);
    await act(async () => {
      addressInput().props.onChangeText(address);
      tree!.root.findByProps({ placeholder: "e.g., Alice Johnson" })
        .props.onChangeText(" Alice ");
    });
    const saveButton = tree!.root.findAllByType(TouchableOpacity).find(
      (button) => button.findAllByType(Text).some(
        (text) => text.props.children === "Save Contact",
      ),
    )!;
    await act(async () => {
      await saveButton.props.onPress();
    });
  }

  it.each([PUBLIC_KEY, `  ${PUBLIC_KEY}  `])(
    "persists the Stellar address and returns to contacts: %s",
    async (address) => {
      await saveAddress(address);

      expect(await getContacts()).toEqual([
        expect.objectContaining({
          id: "contact-id",
          address: PUBLIC_KEY,
          nickname: "Alice",
          tags: [],
        }),
      ]);
      expect(mockReplace).toHaveBeenCalledWith("/contacts");
      expect(Alert.alert).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["42-character garbage", "A".repeat(42)],
    ["Ethereum address", `0x${"a".repeat(40)}`],
    ["arbitrary 0x prefix", "0xgarbage"],
    ["short address", PUBLIC_KEY.slice(0, -1)],
    ["long address", `${PUBLIC_KEY}A`],
    ["invalid base32 character", `G0${PUBLIC_KEY.slice(2)}`],
    ["wrong prefix", `S${PUBLIC_KEY.slice(1)}`],
    ["lowercase address", PUBLIC_KEY.toLowerCase()],
    ["invalid checksum", `${PUBLIC_KEY.slice(0, -1)}A`],
  ])("rejects %s before saving", async (_description, address) => {
    await saveAddress(address);

    expect(Alert.alert).toHaveBeenCalledWith(
      "Error", "Please enter a valid wallet address",
    );
    expect(await getContacts()).toEqual([]);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("requires a non-empty address: %j", async (address) => {
    await saveAddress(address);

    expect(Alert.alert).toHaveBeenCalledWith("Error", "Address is required");
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows a Stellar-style placeholder when adding a contact", async () => {
    await renderScreen(<AddContactScreen />);
    expect(addressInput().props.placeholder).toBe("G...");
  });

  it("shows a Stellar-style placeholder when editing a saved contact", async () => {
    await AsyncStorage.setItem("contacts", JSON.stringify([{
      id: "contact-id",
      address: PUBLIC_KEY,
      nickname: "Alice",
      createdAt: 0,
      updatedAt: 0,
    }]));
    await renderScreen(<EditContactScreen />);

    expect(addressInput().props.placeholder).toBe("G...");
    expect(addressInput().props.value).toBe(PUBLIC_KEY);
  });
});
