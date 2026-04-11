import { useState, useCallback, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@/stores/authStore";
import { saveNote } from "@/services/profile";
import { impactLight } from "@/utils/haptics";
import { COLORS } from "@/constants/colors";

type Props = {
  setToast: (toast: { message: string; variant?: "success" | "error" } | null) => void;
};

export function NoteEditor({ setToast }: Props) {
  const { t } = useTranslation();
  const currentNote = useAuthStore((s) => s.note);
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState(currentNote ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const savingNoteRef = useRef(false);
  const noteInputRef = useRef<TextInput>(null);

  const handleSaveNote = useCallback(async () => {
    if (savingNoteRef.current) return;
    savingNoteRef.current = true;

    const trimmed = noteInput.trim();
    setSavingNote(true);
    impactLight();

    const success = await saveNote(trimmed || null);
    setSavingNote(false);
    savingNoteRef.current = false;

    if (success) {
      useAuthStore.getState().setNote(trimmed || null);
      setEditingNote(false);
    } else {
      setToast({ message: t("radar.couldntUpdateNote"), variant: "error" });
    }
  }, [noteInput, setToast, t]);

  if (editingNote) {
    return (
      <View className="bg-wave-surface rounded-2xl px-4 py-3 mb-3">
        <View className="flex-row items-center">
          <TextInput
            ref={noteInputRef}
            value={noteInput}
            onChangeText={setNoteInput}
            placeholder={t("radar.notePlaceholder")}
            placeholderTextColor={COLORS.placeholder}
            autoCapitalize="sentences"
            autoCorrect={false}
            maxLength={40}
            autoFocus
            className="flex-1 text-white text-sm"
            style={{ lineHeight: 18, paddingVertical: 0 }}
            returnKeyType="done"
            onSubmitEditing={handleSaveNote}
          />
          <Text className="text-wave-muted text-xs ml-2">{noteInput.length}/40</Text>
        </View>
        <View className="flex-row justify-end mt-2" style={{ gap: 8 }}>
          <TouchableOpacity
            onPress={() => { setEditingNote(false); setNoteInput(currentNote ?? ""); }}
            className="px-3 py-1.5"
          >
            <Text className="text-wave-muted text-xs font-semibold">{t("common.cancel")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSaveNote}
            disabled={savingNote}
            className="bg-wave-primary rounded-lg px-4 py-1.5"
          >
            {savingNote ? (
              <ActivityIndicator color={COLORS.white} size="small" />
            ) : (
              <Text className="text-white text-xs font-semibold">{t("common.save")}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => { setNoteInput(currentNote ?? ""); setEditingNote(true); }}
      className="bg-wave-surface/50 rounded-2xl px-4 py-3 mb-3 flex-row items-center"
      activeOpacity={0.7}
    >
      <Ionicons name="create-outline" size={16} color={COLORS.muted} style={{ marginRight: 8 }} />
      <Text className="text-wave-muted text-sm flex-1" numberOfLines={1}>
        {currentNote || t("radar.addNote")}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={COLORS.muted} />
    </TouchableOpacity>
  );
}
