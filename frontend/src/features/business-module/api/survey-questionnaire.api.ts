/**
 * SurveyQuestionnaire API —— 调查问卷专用
 *
 * 阶段 7.2。
 */

import { http } from "@frontend/shared/api/http-client.ts";

export interface MindmapNode {
  id: string;
  text: string;
  children: MindmapNode[];
}

export interface OutlineDTO {
  id: string;
  projectId: string;
  mindmap: MindmapNode | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionDTO {
  id: string;
  parentId: string;
  ordinal: number;
  outlinePath?: string;
  title: string;
  answer?: string;
  createdAt: string;
  updatedAt: string;
}

export const surveyQuestionnaireApi = {
  getOutline(projectId: string) {
    return http.get<{ outline: OutlineDTO | null }>(
      `/api/projects/${projectId}/questionnaire/outline`,
    );
  },
  saveOutline(projectId: string, mindmap: MindmapNode | null) {
    return http.put<OutlineDTO>(
      `/api/projects/${projectId}/questionnaire/outline`,
      { mindmap },
    );
  },
  listQuestions(projectId: string) {
    return http.get<{ questions: QuestionDTO[] }>(
      `/api/projects/${projectId}/questionnaire/questions`,
    );
  },
  createQuestion(
    projectId: string,
    args: { parentId: string; ordinal: number; title: string; outlinePath?: string },
  ) {
    return http.post<QuestionDTO>(
      `/api/projects/${projectId}/questionnaire/questions`,
      args,
    );
  },
  updateQuestion(
    projectId: string,
    questionId: string,
    args: Partial<Pick<QuestionDTO, "title" | "ordinal" | "outlinePath" | "answer">>,
  ) {
    return http.patch<QuestionDTO>(
      `/api/projects/${projectId}/questionnaire/questions/${questionId}`,
      args,
    );
  },
  saveAnswer(projectId: string, questionId: string, answer: string) {
    return http.post<QuestionDTO>(
      `/api/projects/${projectId}/questionnaire/questions/${questionId}/answer`,
      { answer },
    );
  },
  deleteQuestion(projectId: string, questionId: string) {
    return http.del<void>(`/api/projects/${projectId}/questionnaire/questions/${questionId}`);
  },
  batchFromMindmap(projectId: string) {
    return http.post<{ questions: QuestionDTO[] }>(
      `/api/projects/${projectId}/questionnaire/batch-from-mindmap`,
    );
  },
};
