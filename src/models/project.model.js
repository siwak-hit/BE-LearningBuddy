const supabaseService = require('../services/supabase/supabase.service');

const TABLE = 'projects';

const projectModel = {
  async create(payload) {
    return supabaseService.create(TABLE, payload);
  },

  // 👇 INI YANG HARUS DIPERBAIKI 👇
  async findAll() {
    return supabaseService.findAll(TABLE, {
      select: '*, widget_configs(project_key)' // Lakukan JOIN ke widget_configs
    });
  },
  // 👆 ========================== 👆

  async findById(id) {
    return supabaseService.findById(TABLE, id);
  },

  async findBySlug(slug) {
    return supabaseService.findOne(TABLE, { slug });
  },

  async update(id, payload) {
    return supabaseService.updateById(TABLE, id, payload);
  },

  async delete(id) {
    return supabaseService.deleteById(TABLE, id);
  }
};

module.exports = projectModel;
