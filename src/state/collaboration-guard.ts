let collaborationReadOnly = false;
let remoteApplyDepth = 0;

export const setCollaborationReadOnly = (readOnly: boolean): void => {
  collaborationReadOnly = readOnly;
};
export const shouldRejectLocalProjectMutation = (): boolean =>
  collaborationReadOnly && remoteApplyDepth === 0;

export const applyAuthenticatedCollaborationUpdate = <T>(operation: () => T): T => {
  remoteApplyDepth += 1;
  try {
    return operation();
  } finally {
    remoteApplyDepth -= 1;
  }
};
