import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { isSheetInteractionLayerTarget } = await server.ssrLoadModule(
    '/src/components/ui/Sheet/interaction.ts'
  );
  const { useNotificationStore } = await server.ssrLoadModule(
    '/src/stores/useNotificationStore.ts'
  );

  const selectors = [];
  assert.equal(
    isSheetInteractionLayerTarget({
      closest: (selector) => {
        selectors.push(selector);
        return {};
      },
    }),
    true
  );
  assert.deepEqual(selectors, ['[data-sheet-interaction-layer]']);
  assert.equal(isSheetInteractionLayerTarget({ closest: () => null }), false);
  assert.equal(isSheetInteractionLayerTarget(null), false);

  useNotificationStore.setState({
    confirmation: {
      requestId: null,
      isOpen: false,
      isLoading: false,
      options: null,
    },
  });

  let replacedCancellationCount = 0;
  const firstRequestId = useNotificationStore.getState().showConfirmation({
    message: 'first',
    onConfirm: () => {},
    onCancel: () => {
      replacedCancellationCount += 1;
    },
  });
  useNotificationStore.getState().setConfirmationLoading(firstRequestId, true);

  const secondRequestId = useNotificationStore.getState().showConfirmation({
    message: 'second',
    onConfirm: () => {},
  });
  assert.notEqual(firstRequestId, secondRequestId);
  assert.equal(replacedCancellationCount, 1);
  assert.equal(useNotificationStore.getState().confirmation.requestId, secondRequestId);
  assert.equal(useNotificationStore.getState().confirmation.isLoading, false);

  useNotificationStore.getState().setConfirmationLoading(firstRequestId, true);
  useNotificationStore.getState().hideConfirmation(firstRequestId);
  assert.equal(useNotificationStore.getState().confirmation.requestId, secondRequestId);
  assert.equal(useNotificationStore.getState().confirmation.isOpen, true);
  assert.equal(useNotificationStore.getState().confirmation.isLoading, false);

  useNotificationStore.getState().setConfirmationLoading(secondRequestId, true);
  assert.equal(useNotificationStore.getState().confirmation.isLoading, true);
  useNotificationStore.getState().hideConfirmation(secondRequestId);
  assert.deepEqual(useNotificationStore.getState().confirmation, {
    requestId: null,
    isOpen: false,
    isLoading: false,
    options: null,
  });
} finally {
  await server.close();
}

console.log('provider dialog lifecycle tests passed');
