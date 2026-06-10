const supabaseService = require('../supabase/supabase.service');

const ruleService = {
  async getSuggestions(projectId, pageType, triggerWord) {
    try {
      // PERBAIKAN: findAll di sistemmu me-return array langsung, bukan { data, error }
      const data = await supabaseService.findAll('question_suggestions', {
        filters: { project_id: projectId, page_type: pageType, trigger_word: triggerWord, is_active: true },
        orderBy: 'priority',
        ascending: true
      });
      return data || [];
    } catch (error) {
      console.error('[RuleService] Error fetching suggestions:', error);
      return [];
    }
  },

  async evaluatePageRule(projectId, pageType, intent) {
    try {
      const rules = await supabaseService.findAll('page_question_rules', {
        filters: { project_id: projectId, page_type: pageType, is_active: true },
        orderBy: 'priority',
        ascending: true
      });

      for (const rule of rules) {
        const blocked = rule.blocked_intents ? rule.blocked_intents.split(',') : [];
        if (blocked.includes(intent)) {
          return { isBlocked: true, message: rule.fallback_message };
        }
      }
      return { isBlocked: false };
    } catch (error) {
      console.error('[RuleService] Error evaluatePageRule:', error);
      return { isBlocked: false };
    }
  },

  async findActionRule(projectId, intent, message, pageType) {
    try {
      const msgLower = message.toLowerCase();
      const rules = await supabaseService.findAll('action_rules', {
        filters: { project_id: projectId, intent: intent, is_active: true }
      });

      const matchedRule = rules.find(rule => {
        const isPageMatch = rule.page_type === 'any' || rule.page_type === pageType;
        const keywords = rule.trigger_keywords ? rule.trigger_keywords.split(',') : [];
        const isKeywordMatch = keywords.length === 0 || keywords.some(kw => msgLower.includes(kw.trim()));

        return isPageMatch && isKeywordMatch;
      });

      return matchedRule || null;
    } catch (error) {
      console.error('[RuleService] Error findActionRule:', error);
      return null;
    }
  }
};

module.exports = ruleService;
