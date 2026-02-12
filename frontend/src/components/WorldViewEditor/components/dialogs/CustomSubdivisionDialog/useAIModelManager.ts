/**
 * Hook: AI model selection, provider config, status checking.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  checkAIStatus,
  setAIModel,
  setWebSearchModel,
  getAIModels,
  type AIModel,
} from '@/api';

export function useAIModelManager() {
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiMessage, setAiMessage] = useState('');
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [currentModel, setCurrentModel] = useState('gpt-4.1');
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [webSearchModelId, setWebSearchModelId] = useState('gpt-4.1');
  const [webSearchModels, setWebSearchModels] = useState<AIModel[]>([]);
  const [changingModel, setChangingModel] = useState(false);

  // Check AI availability on mount
  useEffect(() => {
    const checkStatus = async () => {
      setCheckingStatus(true);
      try {
        const status = await checkAIStatus();
        setAiAvailable(status.available);
        setAiMessage(status.message);
        if (status.currentModel) {
          setCurrentModel(status.currentModel);
        }
        if (status.availableModels) {
          setAvailableModels(status.availableModels);
        }
        if (status.webSearchModel) {
          setWebSearchModelId(status.webSearchModel);
        }
        if (status.webSearchModels) {
          setWebSearchModels(status.webSearchModels);
        }
      } catch {
        setAiAvailable(false);
        setAiMessage('Failed to connect to AI service');
      } finally {
        setCheckingStatus(false);
      }
    };
    checkStatus();
  }, []);

  // Handle model change
  const handleModelChange = useCallback(async (modelId: string) => {
    setChangingModel(true);
    try {
      const result = await setAIModel(modelId);
      setCurrentModel(result.currentModel);
    } catch (error) {
      console.error('Failed to change model:', error);
    } finally {
      setChangingModel(false);
    }
  }, []);

  // Handle web search model change
  const handleWebSearchModelChange = useCallback(async (modelId: string) => {
    setChangingModel(true);
    try {
      const result = await setWebSearchModel(modelId);
      setWebSearchModelId(result.webSearchModel);
    } catch (error) {
      console.error('Failed to change web search model:', error);
    } finally {
      setChangingModel(false);
    }
  }, []);

  // Refresh available models
  const refreshModels = useCallback(async () => {
    setChangingModel(true);
    try {
      const result = await getAIModels();
      setCurrentModel(result.currentModel);
      setAvailableModels(result.availableModels);
      setWebSearchModelId(result.webSearchModel);
      setWebSearchModels(result.webSearchModels);
    } catch (error) {
      console.error('Failed to refresh models:', error);
    } finally {
      setChangingModel(false);
    }
  }, []);

  return {
    aiAvailable,
    aiMessage,
    checkingStatus,
    currentModel,
    availableModels,
    webSearchModelId,
    webSearchModels,
    changingModel,
    handleModelChange,
    handleWebSearchModelChange,
    refreshModels,
  };
}
