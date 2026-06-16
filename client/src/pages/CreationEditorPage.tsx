import { CreationEditorProvider } from '@/features/creationEditor/CreationEditorContext';
import EditorShell from '@/features/creationEditor/views/EditorShell';

export default function CreationEditorPage() {
  return (
    <CreationEditorProvider>
      <EditorShell />
    </CreationEditorProvider>
  );
}
