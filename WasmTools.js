/**
 * WasmTools.js
 *
 * Written by Robert Hitchcock
 * Created January 11, 2017
 * Last updated January 15, 2017
 */

var WasmTools = WasmTools || (function() {
  var SectionIds = {
    TYPE: 1,
    IMPORT: 2,
    FUNCTION: 3,
    TABLE: 4,
    MEMORY: 5,
    GLOBAL: 6,
    EXPORT: 7,
    START: 8,
    ELEMENT: 9,
    CODE: 10,
    DATA: 11
  }
  function formatUint8(uint8) {
    return '0x' + ('0' + uint8.toString(16)).slice(-2).toUpperCase();
  }
  function formatUint16(uint16) {
    return '0x' + ('0' + uint16.toString(16)).slice(-4).toUpperCase();
  }
  function formatUint32(uint32) {
    return '0x' + ('0' + uint32.toString(16)).slice(-8).toUpperCase();
  }
  // https://en.wikipedia.org/wiki/LEB128
  // Notes: 0x80 == 0b10000000, 0x40 == 0b01000000
  function varuintN(bytes, start, bitLength) {
    var result = 0;
    var byteCount = 0;
    var byte = 0x80;
    while(((byte & 0x80) != 0) && (byteCount < Math.ceil(bitLength / 7))) {
      byte = bytes[start + byteCount];
      result |= (byte & 0x7F) << (byteCount * 7);
      ++byteCount
    }
    return {uint: result, byteLength: byteCount};
  }
  function varintN(bytes, start, bitLength) {
    var result = 0;
    var byteCount = 0;
    var byte = 0x80;
    while(((byte & 0x80) != 0) && (byteCount < Math.ceil(bitLength / 7))) {
      byte = bytes[start + byteCount];
      result |= (byte & 0x7F) << (byteCount * 7);
      ++byteCount
    }
    if (byte & 0x40 != 0) {
      result |= -(1 << (byteCount * 7));
    }
    return {int: result, byteLength: byteCount};
  }
  // http://webassembly.org/docs/binary-encoding/
  function WasmByteStreamIterator(byteStream, index) {
    this.index = index;
    this.byteStream = byteStream;
  }
  WasmByteStreamIterator.prototype.relativeJump = function(offset) {
    this.index += offset;
  };
  WasmByteStreamIterator.prototype.absoluteJump = function(offset) {
    this.index = offset;
  };
  WasmByteStreamIterator.prototype.varUint = function(bits) {
    var result = varuintN(this.byteStream, this.index, bits);
    this.index += result.byteLength;
    return result.uint;
  };
  WasmByteStreamIterator.prototype.varUint1 = function() {
    return this.varUint(1);
  };
  WasmByteStreamIterator.prototype.varUint7 = function() {
    return this.varUint(7);
  };
  WasmByteStreamIterator.prototype.varUint32 = function() {
    return this.varUint(32);
  };
  WasmByteStreamIterator.prototype.varUint64 = function() {
    return this.varUint(64);
  };
  WasmByteStreamIterator.prototype.uint = function(bits) {
    var result = 0;
    for (var i = 0; i < Math.ceil(bits / 8); ++i) {
      result += this.byteStream[this.index++] << (i * 8);
    }
    return result;
  };
  WasmByteStreamIterator.prototype.uint8 = function() {
    return this.uint(8);
  };
  WasmByteStreamIterator.prototype.uint16 = function() {
    return this.uint(8);
  };
  WasmByteStreamIterator.prototype.uint32 = function() {
    return this.uint(32);
  };
  WasmByteStreamIterator.prototype.uint64 = function() {
    return this.uint(64);
  };
  WasmByteStreamIterator.prototype.varInt = function(bits) {
    var result = varintN(this.byteStream, this.index, bits);
    this.index += result.byteLength;
    return result.int;
  };
  WasmByteStreamIterator.prototype.varInt7 = function() {
    return this.varInt(7);
  };
  WasmByteStreamIterator.prototype.varInt16 = function() {
    return this.varInt(16);
  }
  WasmByteStreamIterator.prototype.varInt32 = function() {
    return this.varInt(32);
  };
  WasmByteStreamIterator.prototype.varInt64 = function() {
    return this.varInt(64);
  };
  WasmByteStreamIterator.prototype.valueType = function() {
    switch (this.varUint7()) {
      case 0x7F: return 'i32';
      case 0x7E: return 'i64';
      case 0x7D: return 'f32';
      case 0x7C: return 'f64';
      default: throw new Error('Invalid value_type!');
    }
  };
  WasmByteStreamIterator.prototype.blockType = function() {
    switch (this.varUint7()) {
      case 0x7F: return 'i32';
      case 0x7E: return 'i64';
      case 0x7D: return 'f32';
      case 0x7C: return 'f64';
      case 0x70: return 'anyfunc';
      case 0x60: return 'func';
      case 0x40: return 'empty';
      default: throw new Error('Invalid block_type!');
    }
  };
  WasmByteStreamIterator.prototype.resizableLimits = function() {
    var flags = this.varUint1();
    var initial = this.varUint32();
    if (flags) {
      var maximum = this.varUint32();
      return {flags: flags, initial: initial, maximum: maximum};
    } else {
      return {flags: flags, initial: initial};
    }
  };
  WasmByteStreamIterator.prototype.initExpr = function() {
    var code = [];
    var instruction;
    do {
      instruction = this.instruction();
      code.push(instruction);
    } while (instruction != 'end');
    return code;
  };
  WasmByteStreamIterator.prototype.tableType = function() {
    var elementType = this.elemType();
    var limits = this.resizableLimits();
  };
  WasmByteStreamIterator.prototype.elemType = function() {
    switch (this.uint8()) { // TODO: make varint7
      case 0x70: return 'anyfunc';
      default: throw new Error('Invalid elem_type!');
    }
  };
  WasmByteStreamIterator.prototype.memoryImmediate = function() {
    var flags = this.varUint32();
    var offset = this.varUint32();
    return {flags: flags, offset: offset};
  };
  WasmByteStreamIterator.prototype.brTable = function() {
    var targetCount = this.varUint32();
    var targetTable = [];
    for (var i = 0; i < targetCount; ++i) {
      targetTable.push(this.varUint32());
    }
    var defaultTarget = this.varUint32();
    return {targetCount: targetCount, targetTable: targetTable, defaultTarget: defaultTarget};
  };
  WasmByteStreamIterator.prototype.funcType = function() {
    var form = this.uint8(); // TODO: Make this varint7 instead.
    if (form != 0x60) {
      throw new Error('Invalid func_type!');
    }
    var paramCount = this.varUint32();
    var paramTypes = [];
    for (var i = 0; i < paramCount; ++i) {
      paramTypes.push(this.valueType());
    }
    var returnCount = this.varUint1();
    var result = {form: form, paramCount: paramCount, paramTypes: paramTypes, returnCount: returnCount};
    if (returnCount > 1) {
      throw new Error('Invalid func_type!');
    } else if (returnCount == 1) {
      result.returnType = this.valueType();
    }
    return result;
  };
  WasmByteStreamIterator.prototype.externalKind = function() {
    switch (this.uint8()) {
      case 0: return 'Function';
      case 1: return 'Table';
      case 2: return 'Memory';
      case 3: return 'Global';
      default: throw new Error('Invalid external_kind!');
    }
  };
  WasmByteStreamIterator.prototype.memoryType = function() {
    var limits = this.resizableLimits();
    return {limits: limits};
  };
  WasmByteStreamIterator.prototype.importEntry = function() {
    var moduleLen = this.varUint32();
    var moduleStr = '';
    for (var i = 0; i < moduleLen; ++i) {
      moduleStr += String.fromCharCode(this.uint8());
    }
    var fieldLen = this.varUint32();
    var fieldStr = '';
    for (var i = 0; i < fieldLen; ++i) {
      fieldStr += String.fromCharCode(this.uint8());
    }
    var kind = this.externalKind();
    var type = (function(wbsi) {
      switch (kind) {
        case 'Function': return wbsi.varUint32();
        case 'Table': return wbsi.tableType();
        case 'Memory': return wbsi.memoryType();
        case 'Global': return wbsi.globalType();
        default: throw new Error('Invalid external_kind!');
      }
    })(this);
    return {moduleLen: moduleLen, moduleStr: moduleStr, fieldLen: fieldLen, fieldStr: fieldStr, kind: kind, type: type};
  };
  WasmByteStreamIterator.prototype.globalVariable = function() {
    var type = this.globalType();
    var init = this.initExpr();
    return {type: type, init: init};
  };
  WasmByteStreamIterator.prototype.exportEntry = function() {
    var fieldLen = this.varUint32();
    var fieldStr = '';
    for (var i = 0; i < fieldLen; ++i) {
      fieldStr += String.fromCharCode(this.uint8());
    }
    var kind = this.externalKind();
    var index = this.varUint32();
    return {fieldLen: fieldLen, fieldStr: fieldStr, kind: kind, index: index};
  };
  WasmByteStreamIterator.prototype.startSectionPayload = function() {
    var index = this.varUint32();
    return index;
  };
  WasmByteStreamIterator.prototype.elemSegment = function() {
    var index = this.varUint32();
    var offset = this.initExpr();
    var numElem = this.varUint32();
    var elems = [];
    for (var i = 0; i < numElem; ++i) {
      elems.push(this.varUint32());
    }
    return {index: index, offset: offset, numElem: numElem, elems: elems};
  };
  WasmByteStreamIterator.prototype.functionBody = function() {
    var bodySize = this.varUint32();
    var startIndex = this.index;
    var localCount = this.varUint32();
    var locals = [];
    for (var i = 0; i < localCount; ++i) {
      locals.push(this.localEntry());
    }
    var code = [];
    while(this.index - startIndex < bodySize - 1) {
      code.push(this.instruction());
    }
    var end = this.instruction();
    if (end != 'end') {
      throw new Error('Invalid function_body!');
    }
    return {bodySize: bodySize, localCount: localCount, locals: locals, code: code, end: end};
  };
  WasmByteStreamIterator.prototype.dataSegment = function() {
    var index = this.varUint32();
    var offset = this.initExpr();
    var size = this.varUint32();
    var data = [];
    for (var i = 0; i < size; ++i) {
      data.push(this.uint8());
    }
    return {index: index, offset: offset, size: size, data: data};
  };
  WasmByteStreamIterator.prototype.dataSectionPayload = function() {
    var count = this.varUint32();
    var entries = [];
    for (var i = 0; i < count; ++i) {
      entries.push(this.dataSegment());
    }
    return {count: count, entries: entries};
  };
  WasmByteStreamIterator.prototype.codeSectionPayload = function() {
    var count = this.varUint32();
    var bodies = [];
    for (var i = 0; i < count; ++i) {
      bodies.push(this.functionBody());
    }
    return {count: count, bodies: bodies};
  };
  WasmByteStreamIterator.prototype.elementSectionPayload = function() {
    var count = this.varUint32();
    var entries = [];
    for (var i = 0; i < count; ++i) {
      entries.push(this.elemSegment());
    }
    return {count: count, entries: entries};
  };
  WasmByteStreamIterator.prototype.typeSectionPayload = function() {
    var count = this.varUint32();
    var entries = [];
    for (var i = 0; i < count; ++i) {
      entries.push(this.funcType());
    }
    return {count: count, entries: entries};
  };
  WasmByteStreamIterator.prototype.importSectionPayload = function() {
    var count = this.varUint32();
    var entries = [];
    for (var i = 0; i < count; ++i) {
      entries.push(this.importEntry());
    }
    return {count: count, entries: entries};
  }
  WasmByteStreamIterator.prototype.functionSectionPayload = function() {
    var count = this.varUint32();
    var types = [];
    for (var i = 0; i < count; ++i) {
      types.push(this.varUint32());
    }
    return {count: count, types: types};
  };
  WasmByteStreamIterator.prototype.tableSectionPayload = function() {
    var count = this.varUint32();
    var entries = [];
    for (var i = 0; i < count; ++i) {
      entries.push(this.tableType());
    }
    return {count: count, entries: entries};
  };
  WasmByteStreamIterator.prototype.memorySectionPayload = function() {
    var count = this.varUint32();
    var entries = [];
    for (var i = 0; i < count; ++i) {
      entries.push(this.memoryType());
    }
    return {count: count, entries: entries};
  };
  WasmByteStreamIterator.prototype.globalSectionPayload = function() {
    var count = this.varUint32();
    var globals = [];
    for (var i = 0; i < count; ++i) {
      globals.push(this.globalVariable());
    }
    return {count: count, globals: globals};
  };
  WasmByteStreamIterator.prototype.exportSectionPayload = function() {
    var count = this.varUint32();
    var entries = [];
    for (var i = 0; i < count; ++i) {
      entries.push(this.exportEntry());
    }
    return {count: count, entries: entries};
  };
  WasmByteStreamIterator.prototype.section = function() {
    var id = this.varUint7();
    var payloadLen = this.varUint32();
    var payloadStartIndex = this.index;
    var payload = (function(wbsi) {
      switch (id) {
        case SectionIds.TYPE: return wbsi.typeSectionPayload();
        case SectionIds.IMPORT: return wbsi.importSectionPayload();
        case SectionIds.FUNCTION: return wbsi.functionSectionPayload();
        case SectionIds.TABLE: return wbsi.tableSectionPayload();
        case SectionIds.MEMORY: return wbsi.memorySectionPayload();
        case SectionIds.GLOBAL: return wbsi.globalSectionPayload();
        case SectionIds.EXPORT: return wbsi.exportSectionPayload();
        case SectionIds.START: return wbsi.startSectionPayload();
        case SectionIds.ELEMENT: return wbsi.elementSectionPayload();
        case SectionIds.CODE: return wbsi.codeSectionPayload();
        case SectionIds.DATA: return wbsi.dataSectionPayload();
        default: return (function() {
            var sizeOfNameLen = -wbsi.index;
            var nameLen = wbsi.varUint32();
            sizeOfNameLen += wbsi.index;
            var name = '';
            for (var i = 0; i < nameLen; ++i) {
              name += String.fromCharCode(wbsi.uint8());
            }
            var payloadData = [];
            for (var i = sizeOfNameLen + nameLen; i < payloadLen; ++i) {
              payloadData.push(formatUint8(wbsi.uint8()));
            }
            return {nameLen: nameLen, name: name, payloadData: payloadData};
          })();
      }
    })(this);
    this.absoluteJump(payloadStartIndex + payloadLen); // TODO: needed???
    return {id: id, payloadLen: payloadLen, payload: payload};
  };
  WasmByteStreamIterator.prototype.instruction = function() {
    switch (this.byteStream[this.index++]) {
      case 0x00: return 'unreachable';
      case 0x01: return 'nop';
      case 0x02: return 'block ' + this.blockType();
      case 0x03: return 'loop ' + this.blockType();
      case 0x04: return 'if ' + this.blockType();
      case 0x05: return 'else';
      case 0x0B: return 'end';
      case 0x0C: return 'br ' + this.varUint32();
      case 0x0D: return 'br_if ' + this.varUint32();
      case 0x0E: return 'br_table ' + this.brTable();
      case 0x0F: return 'return';
      case 0x10: return 'call ' + this.varUint32();
      case 0x11: return 'call_indirect ' + this.varUint32() + ' ' + this.varUint1();
      case 0x1A: return 'drop';
      case 0x1B: return 'select';
      case 0x20: return 'get_local ' + this.varUint32();
      case 0x21: return 'set_local ' + this.varUint32();
      case 0x22: return 'tee_local ' + this.varUint32();
      case 0x23: return 'get_global ' + this.varUint32();
      case 0x24: return 'set_global ' + this.varUint32();
      case 0x28: return 'i32.load ' + this.memoryImmediate();
      case 0x29: return 'i64.load ' + this.memoryImmediate();
      case 0x2A: return 'f32.load ' + this.memoryImmediate();
      case 0x2B: return 'f64.load ' + this.memoryImmediate();
      case 0x2C: return 'i32.load8_s ' + this.memoryImmediate();
      case 0x2D: return 'i32.load8_u ' + this.memoryImmediate();
      case 0x2E: return 'i32.load16_s ' + this.memoryImmediate();
      case 0x2F: return 'i32.load16_u ' + this.memoryImmediate();
      case 0x30: return 'i64.load8_s ' + this.memoryImmediate();
      case 0x31: return 'i64.load8_u ' + this.memoryImmediate();
      case 0x32: return 'i64.load16_s ' + this.memoryImmediate();
      case 0x33: return 'i64.load16_u ' + this.memoryImmediate();
      case 0x34: return 'i64.load32_s ' + this.memoryImmediate();
      case 0x35: return 'i64.load32_u ' + this.memoryImmediate();
      case 0x36: return 'i32.store ' + this.memoryImmediate();
      case 0x37: return 'i64.store ' + this.memoryImmediate();
      case 0x38: return 'f32.store ' + this.memoryImmediate();
      case 0x39: return 'f64.store ' + this.memoryImmediate();
      case 0x3A: return 'i32.store8 ' + this.memoryImmediate();
      case 0x3B: return 'i32.store16 ' + this.memoryImmediate();
      case 0x3C: return 'i64.store8 ' + this.memoryImmediate();
      case 0x3D: return 'i64.store16 ' + this.memoryImmediate();
      case 0x3E: return 'i64.store32 ' + this.memoryImmediate();
      case 0x3F: return 'current_memory ' + this.varUint1();
      case 0x40: return 'grow_memory ' + this.varUint1();
      case 0x41: return 'i32.const ' + this.varInt32();
      case 0x42: return 'i64.const ' + this.varInt64();
      case 0x43: return 'f32.const ' + this.uint32();
      case 0x44: return 'f64.const ' + this.uint64();
      case 0x45: return 'i32.eqz';
      case 0x46: return 'i32.eq';
      case 0x47: return 'i32.ne';
      case 0x48: return 'i32.lt_s';
      case 0x49: return 'i32.lt_u';
      case 0x4A: return 'i32.gt_s';
      case 0x4B: return 'i32.gt_u';
      case 0x4C: return 'i32.le_s';
      case 0x4D: return 'i32.le_u';
      case 0x4E: return 'i32.ge_s';
      case 0x4F: return 'i32.ge_u';
      case 0x50: return 'i64.eqz';
      case 0x51: return 'i64.eq';
      case 0x52: return 'i64.ne';
      case 0x53: return 'i64.lt_s';
      case 0x54: return 'i64.lt_u';
      case 0x55: return 'i64.gt_s';
      case 0x56: return 'i64.gt_u';
      case 0x57: return 'i64.le_s';
      case 0x58: return 'i64.le_u';
      case 0x59: return 'i64.ge_s';
      case 0x5A: return 'i64.ge_u';
      case 0x5B: return 'f32.eq';
      case 0x5C: return 'f32.ne';
      case 0x5D: return 'f32.lt';
      case 0x5E: return 'f32.gt';
      case 0x5F: return 'f32.le';
      case 0x60: return 'f32.ge';
      case 0x61: return 'f64.eq';
      case 0x62: return 'f64.ne';
      case 0x63: return 'f64.lt';
      case 0x64: return 'f64.gt';
      case 0x65: return 'f64.le';
      case 0x66: return 'f64.ge';
      case 0x67: return 'i32.clz';
      case 0x68: return 'i32.ctz';
      case 0x69: return 'i32.popcnt';
      case 0x6A: return 'i32.add';
      case 0x6B: return 'i32.sub';
      case 0x6C: return 'i32.mul';
      case 0x6D: return 'i32.div_s';
      case 0x6E: return 'i32.div_u';
      case 0x6F: return 'i32.rem_s';
      case 0x70: return 'i32.rem_u';
      case 0x71: return 'i32.and';
      case 0x72: return 'i32.or';
      case 0x73: return 'i32.xor';
      case 0x74: return 'i32.shl';
      case 0x75: return 'i32.shr_s';
      case 0x76: return 'i32.shr_u';
      case 0x77: return 'i32.rotl';
      case 0x78: return 'i32.rotr';
      case 0x79: return 'i64.clz';
      case 0x7A: return 'i64.ctz';
      case 0x7B: return 'i64.popcnt';
      case 0x7C: return 'i64.add';
      case 0x7D: return 'i64.sub';
      case 0x7E: return 'i64.mul';
      case 0x7F: return 'i64.div_s';
      case 0x80: return 'i64.div_u';
      case 0x81: return 'i64.rem_s';
      case 0x82: return 'i64.rem_u';
      case 0x83: return 'i64.and';
      case 0x84: return 'i64.or';
      case 0x85: return 'i64.xor';
      case 0x86: return 'i64.shl';
      case 0x87: return 'i64.shr_s';
      case 0x88: return 'i64.shr_u';
      case 0x89: return 'i64.rotl';
      case 0x8A: return 'i64.rotr';
      case 0x8B: return 'f32.abs';
      case 0x8C: return 'f32.neg';
      case 0x8D: return 'f32.ceil';
      case 0x8E: return 'f32.floor';
      case 0x8F: return 'f32.trunc';
      case 0x90: return 'f32.nearest';
      case 0x91: return 'f32.sqrt';
      case 0x92: return 'f32.add';
      case 0x93: return 'f32.sub';
      case 0x94: return 'f32.mul';
      case 0x95: return 'f32.div';
      case 0x96: return 'f32.min';
      case 0x97: return 'f32.max';
      case 0x98: return 'f32.copysign';
      case 0x99: return 'f64.abs';
      case 0x9A: return 'f64.neg';
      case 0x9B: return 'f64.ceil';
      case 0x9C: return 'f64.floor';
      case 0x9D: return 'f64.trunc';
      case 0x9E: return 'f64.nearest';
      case 0x9F: return 'f64.sqrt';
      case 0xA0: return 'f64.add';
      case 0xA1: return 'f64.sub';
      case 0xA2: return 'f64.mul';
      case 0xA3: return 'f64.div';
      case 0xA4: return 'f64.min';
      case 0xA5: return 'f64.max';
      case 0xA6: return 'f64.copysign';
      case 0xA7: return 'i32.wrap/i64';
      case 0xA8: return 'i32.trunc_s/f32';
      case 0xA9: return 'i32.trunc_u/f32';
      case 0xAA: return 'i32.trunc_s/f64';
      case 0xAB: return 'i32.trunc_u/f64';
      case 0xAC: return 'i64.extend_s/i32';
      case 0xAD: return 'i64.extend_u/i32';
      case 0xAE: return 'i64.trunc_s/f32';
      case 0xAF: return 'i64.trunc_u/f32';
      case 0xB0: return 'i64.trunc_s/f64';
      case 0xB1: return 'i64.trunc_u/f64';
      case 0xB2: return 'f32.convert_s/i32';
      case 0xB3: return 'f32.convert_u/i32';
      case 0xB4: return 'f32.convert_s/i64';
      case 0xB5: return 'f32.convert_u/i64';
      case 0xB6: return 'f32.demote/f64';
      case 0xB7: return 'f64.convert_s/i32';
      case 0xB8: return 'f64.convert_u/i32';
      case 0xB9: return 'f64.convert_s/i64';
      case 0xBA: return 'f64.convert_u/i64';
      case 0xBB: return 'f64.promote/f32';
      case 0xBC: return 'i32.reinterpret/f32';
      case 0xBD: return 'i64.reinterpret/f64';
      case 0xBE: return 'f32.reinterpret/i32';
      case 0xBF: return 'f64.reinterpret/i64';
      default: throw new Error('Invalid instruction!');
    }
  };
  WasmByteStreamIterator.prototype.module = function() {
    var magicNumber = this.uint32();
    if (magicNumber != 0x6D736100) { // '\0asm'
      throw new Error('Not a valid WebAssembly file.');
    }
    var version = this.uint32();
    var sections = [];
    while (this.index < this.byteStream.byteLength) {
      sections.push(this.section());
    }
    return {magicNumber: magicNumber, version: version, sections: sections};
  };
  function WasmModule(module) {
    this.module = module;
    this.version = module.version;
    var exportSection = this.getKnownSection(SectionIds.EXPORT);
    var typeSection = this.getKnownSection(SectionIds.TYPE);
    this.exports = [];
    if (exportSection != null) {
      var payload = exportSection.payload;
      for (var i in payload.entries) {
        var entry = payload.entries[i];
        this.exports.push({id: entry.index, name: entry.fieldStr, kind: entry.kind})
      }
    }
    this.functions = [];
    if (typeSection != null) {
      var payload = typeSection.payload;
      for (var i in payload.entries) {
        var entry = payload.entries[i];
        var f = {};
        f.name = this.getFunctionName(i);
        f.params = [];
        for (var j in entry.paramTypes) {
          f.params.push(entry.paramTypes[j]);
        }
        f.results = [];
        if (entry.returnType) {
          f.results.push(entry.paramTypes[j]);
        }
        f.instructions = this.getFunctionCode(i);
        this.functions.push(f);
      }
    }
  }
  WasmModule.prototype.getKnownSection = function(id) {
    var sections = this.module.sections;
    for (var i in sections) {
      var section = sections[i];
      if (section.id == id) {
        return section;
      }
    }
    return null;
  }
  WasmModule.prototype.getFunctions = function() {
    return this.functions;
  };
  WasmModule.prototype.getFunctionName = function(id) {
    for (var i in this.exports) {
      var e = this.exports[i];
      if (e.kind == 'Function' && e.id == id) {
        return '$' + e.name;
      }
    }
    return null;
  };
  WasmModule.prototype.getFunctionCode = function(id) {
    var code = [];
    var codeSection = this.getKnownSection(SectionIds.CODE);
    if (codeSection != null && codeSection.payload.bodies.length > id) {
      var body = codeSection.payload.bodies[id];
      for (var i in body.code) {
        code.push(body.code[i]);
      }
    }
    return code;
  };
  WasmModule.prototype.getSExpression = function() {
    var expr = '(module';
    for (var i in this.exports) {
      var e = this.exports[i];
      expr += '\n  (export "' + e.name + '" (' + e.kind + ' $' + e.name + '))';
    }
    var functions = this.getFunctions();
    for (var i in this.functions) {
      var f = this.functions[i];
      expr += '\n  (func' + (f.name ? ' ' + f.name : '') + (f.params.length ? ' (param ' + f.params.join(' ') + ')': '') + (f.results.length ? ' (result ' + f.results.join(' ') + ')' : '');
      for (var j in f.instructions) {
        expr += '\n    (' + f.instructions[j] + ')';
      }
      expr += ')';
    }
    expr += ')\n';
    return expr;
  };
  function disassemble(byteStream) {
    var wbsi = new WasmByteStreamIterator(byteStream, 0);
    return new WasmModule(wbsi.module());
  }
  return {
    formatUint8: formatUint8,
    formatUint16: formatUint16,
    formatUint32: formatUint32,
    disassemble : disassemble
  }
})();
