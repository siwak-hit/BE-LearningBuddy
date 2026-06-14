// src/services/project/project-identity.service.js
const projectModel = require('../../models/project.model');
const chatModel = require('../../models/chat.model');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

function safeParseObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) || fallback; } catch (_) { return fallback; }
}

function pickProjectKey({ projectKey, session, pageContext }) {
  const sessionPageContext = safeParseObject(session?.page_context, {});
  const requestPageContext = safeParseObject(pageContext, {});

  return (
    projectKey ||
    session?.project_key ||
    sessionPageContext.projectKey ||
    sessionPageContext.project_key ||
    sessionPageContext.widget?.projectKey ||
    requestPageContext.projectKey ||
    requestPageContext.project_key ||
    requestPageContext.widget?.projectKey ||
    null
  );
}

const projectIdentityService = {
  isValidUuid,

  async resolveProjectIdentity({ projectId, projectKey, session, pageContext } = {}) {
    const debug = {
      inputProjectId: projectId || null,
      inputProjectKey: projectKey || null,
      sessionProjectId: session?.project_id || null,
      hasSessionProjectId: Boolean(session?.project_id),
      resolvedFrom: null
    };

    if (isValidUuid(projectId)) {
      debug.resolvedFrom = 'request.projectId';
      return { projectId: projectId.trim(), projectKey: pickProjectKey({ projectKey, session, pageContext }), debug };
    }

    if (isValidUuid(session?.project_id)) {
      debug.resolvedFrom = 'session.project_id';
      return { projectId: session.project_id.trim(), projectKey: pickProjectKey({ projectKey, session, pageContext }), debug };
    }

    const resolvedProjectKey = pickProjectKey({ projectKey, session, pageContext });
    if (resolvedProjectKey) {
      const project = await projectModel.findByProjectKey(resolvedProjectKey);
      if (project?.id && isValidUuid(project.id)) {
        debug.resolvedFrom = 'widget_configs.project_key';
        return { projectId: project.id, projectKey: resolvedProjectKey, project, debug };
      }

      const fallbackProjectId = await chatModel.getProjectIdByKey(resolvedProjectKey);
      if (isValidUuid(fallbackProjectId)) {
        debug.resolvedFrom = 'chatModel.getProjectIdByKey';
        return { projectId: fallbackProjectId, projectKey: resolvedProjectKey, debug };
      }
    }

    debug.resolvedFrom = null;
    return { projectId: null, projectKey: resolvedProjectKey || null, debug };
  }
};

module.exports = projectIdentityService;
