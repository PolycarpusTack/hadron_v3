import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import logger from '../services/logger';

interface InlineEditorProps {
  analysisId: number;
  fieldName: string;
  value: string;
  multiline?: boolean;
  onSave?: (newValue: string) => void;
}

export const InlineEditor: React.FC<InlineEditorProps> = ({
  analysisId,
  fieldName,
  value,
  multiline = true,
  onSave
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(editedValue.length, editedValue.length);
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (editedValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await invoke('submit_analysis_feedback', {
        feedback: {
          analysisId,
          feedbackType: 'edit',
          fieldName,
          originalValue: value,
          newValue: editedValue,
        }
      });
      onSave?.(editedValue);
      setIsEditing(false);
    } catch (error) {
      logger.error('Failed to save edit', { error });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    }
  };

  if (!isEditing) {
    return (
      <div className="inline-editor-display">
        <span className="editor-content">{value}</span>
        <button
          className="edit-btn"
          onClick={() => setIsEditing(true)}
          title="Edit (Ctrl+Click)"
        >
          ✏️
        </button>
      </div>
    );
  }

  return (
    <div className="inline-editor-editing">
      {multiline ? (
        <textarea
          ref={textareaRef}
          value={editedValue}
          onChange={(e) => setEditedValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={4}
          disabled={isSaving}
        />
      ) : (
        <input
          type="text"
          value={editedValue}
          onChange={(e) => setEditedValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
        />
      )}
      <div className="editor-actions">
        <button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={handleCancel} disabled={isSaving}>
          Cancel
        </button>
        <span className="editor-hint">Ctrl+Enter to save, Esc to cancel</span>
      </div>
    </div>
  );
};

export default InlineEditor;
