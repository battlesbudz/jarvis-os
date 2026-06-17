import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export interface UserDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: 'processing' | 'ready' | 'error';
  summary?: string | null;
  uploadedAt: string;
}

interface ProfileDocumentsPanelProps {
  documents: UserDocument[];
  documentsLoading: boolean;
  documentUploading: boolean;
  profileChipColor: string;
  sectionTitleStyle: any;
  platformsListStyle: any;
  onUploadDocument: () => void;
  onDeleteDocument: (id: string, name: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProfileDocumentsPanel({ documents, documentsLoading, documentUploading, profileChipColor, sectionTitleStyle, platformsListStyle, onUploadDocument, onDeleteDocument }: ProfileDocumentsPanelProps) {
  const uploadDisabled = documentUploading || documents.length >= 10;

  return (
    <>
      <Text style={[sectionTitleStyle, { marginTop: 28 }]}>My Documents</Text>
      <View style={platformsListStyle}>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 }}>
            Upload documents so Jarvis can read them and refer back to them in every conversation. Supports PDF, Word, text files, and images.
          </Text>
          <Pressable style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingVertical: 11,
            borderRadius: 12,
            backgroundColor: documentUploading ? profileChipColor : '#6366F1',
            opacity: uploadDisabled ? 0.6 : 1,
          }} onPress={onUploadDocument} disabled={uploadDisabled}>
            {documentUploading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="cloud-upload-outline" size={18} color="#fff" />}
            <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' }}>
              {documentUploading ? 'Uploading...' : documents.length >= 10 ? 'Limit reached (10)' : 'Upload Document'}
            </Text>
          </Pressable>
        </View>

        {documentsLoading && documents.length === 0 ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 14, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={Colors.textTertiary} />
          </View>
        ) : documents.length === 0 ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textTertiary, textAlign: 'center' }}>
              No documents uploaded yet
            </Text>
          </View>
        ) : (
          <View style={{ paddingBottom: 8 }}>
            {documents.map((doc, idx) => (
              <View key={doc.id} style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderTopWidth: idx === 0 ? 1 : 0,
                borderTopColor: Colors.border,
                borderBottomWidth: 1,
                borderBottomColor: Colors.border,
                gap: 10,
              }}>
                <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#6366F115', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={doc.mimeType === 'application/pdf' ? 'document-text-outline' : doc.mimeType.startsWith('image/') ? 'image-outline' : 'document-outline'} size={18} color="#6366F1" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text }} numberOfLines={1}>
                    {doc.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    {doc.status === 'processing' ? (
                      <>
                        <ActivityIndicator size="small" color="#6366F1" style={{ transform: [{ scale: 0.7 }] }} />
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#6366F1' }}>Reading...</Text>
                      </>
                    ) : doc.status === 'error' ? (
                      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#EF4444' }}>Failed to read</Text>
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
                        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textTertiary }}>
                          {formatFileSize(doc.sizeBytes)} · Ready
                        </Text>
                      </>
                    )}
                  </View>
                </View>
                <Pressable onPress={() => onDeleteDocument(doc.id, doc.name)} hitSlop={10} style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </>
  );
}
