// Bounded native diagnostics only. No trading, DLL, WebRequest or permission APIs.
#property strict
#property version "1.03"
#property script_show_inputs
#property description "Read-only paired time trace; Algo Trading must remain OFF."

input string DiagnosticRunId="";
string RUN_ID="";
string TRACE="";
string ACK="";
string READY="";
string CLOSED="";
// Protocol wait only; source quote freshness limits are unchanged.
const int ACK_WAIT_MILLISECONDS=100000;

string ProtocolPayload(string kind) { return "YMT5-1|"+RUN_ID+"|"+kind+"\n"; }
string AckFile(int sequence) { return ACK+"-"+IntegerToString(sequence)+".txt"; }

bool ProtocolMatches(string name,string expected)
{
   int handle=FileOpen(name,FILE_READ|FILE_BIN|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE,0,CP_UTF8);
   if(handle==INVALID_HANDLE) return false;
   // Exact ASCII bytes, including LF: partial files, trailing data and old
   // sequence-only ACKs cannot be mistaken for a complete acknowledgement.
   bool matches=false;
   if(FileSize(handle)==StringLen(expected))
      matches=FileReadString(handle,StringLen(expected))==expected;
   FileClose(handle);
   return matches;
}

bool CollectorReady()
{
   return !FileIsExist(CLOSED,FILE_COMMON) && ProtocolMatches(READY,ProtocolPayload("ready"));
}

bool ValidRunId(string value)
{
   int length=StringLen(value);
   if(length<1 || length>64) return false;
   for(int index=0; index<length; index++)
   {
      ushort letter=StringGetCharacter(value,index);
      bool alphanumeric=(letter>=48 && letter<=57) || (letter>=65 && letter<=90) || (letter>=97 && letter<=122);
      if(!alphanumeric && !(index>0 && (letter==45 || letter==95))) return false;
   }
   return true;
}

bool Safe()
{
   return !MQLInfoInteger(MQL_TESTER)
      && TerminalInfoInteger(TERMINAL_CONNECTED)
      && !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)
      && AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO
      && AccountInfoInteger(ACCOUNT_LOGIN)==5058025194
      && AccountInfoString(ACCOUNT_SERVER)=="MetaQuotes-Demo";
}

string Number(long value) { return StringFormat("%I64d",value); }
string Boolean(bool value) { return value ? "true" : "false"; }

void LogCheck(string name,bool passed)
{
   Print("Yosemite CHECK ",name,"=",passed ? "PASS" : "FAIL");
}

void LogStartupChecks()
{
   LogCheck("outside_strategy_tester",!MQLInfoInteger(MQL_TESTER));
   LogCheck("terminal_connected",(bool)TerminalInfoInteger(TERMINAL_CONNECTED));
   LogCheck("algo_trading_off",!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED));
   LogCheck("native_demo_account",AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO);
   LogCheck("approved_account",AccountInfoInteger(ACCOUNT_LOGIN)==5058025194);
   LogCheck("approved_server",AccountInfoString(ACCOUNT_SERVER)=="MetaQuotes-Demo");
}

void LogStop(string reason,int acknowledged_frames)
{
   Print("Yosemite STOP reason=",reason," acknowledged_frames=",acknowledged_frames," executionAllowed=false");
}

void OnStart()
{
   if(!ValidRunId(DiagnosticRunId)) { LogStop("invalid_diagnostic_run_id",0); return; }
   RUN_ID=DiagnosticRunId;
   TRACE="YosemiteTimeTrace-"+RUN_ID+".jsonl";
   ACK="YosemiteTimeTraceAck-"+RUN_ID;
   READY=ACK+"-ready.txt";
   CLOSED=ACK+"-closed.txt";
   Print("Yosemite START run_id=",RUN_ID," build=",TerminalInfoInteger(TERMINAL_BUILD));
   Print("Yosemite OUTPUT FILE_COMMON directory=",TerminalInfoString(TERMINAL_COMMONDATA_PATH),"\\Files trace=",TRACE," ack=",ACK);
   LogStartupChecks();
   if(!Safe()) { LogStop("startup_safety_check_failed",0); return; }
   bool trace_exists=FileIsExist(TRACE,FILE_COMMON);
   bool ack_exists=FileIsExist(ACK+".txt",FILE_COMMON);
   for(int index=0;index<3;index++) ack_exists=ack_exists || FileIsExist(AckFile(index),FILE_COMMON);
   LogCheck("trace_file_absent",!trace_exists);
   LogCheck("ack_file_absent",!ack_exists);
   if(trace_exists || ack_exists)
   { LogStop("existing_run_output",0); return; }
   LogCheck("collector_ready",CollectorReady());
   if(!CollectorReady()) { LogStop("collector_not_ready_or_closed",0); return; }
   ResetLastError();
   int file=FileOpen(TRACE,FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON|FILE_SHARE_READ,0,CP_UTF8);
   if(file==INVALID_HANDLE) { Print("Yosemite FILE_OPEN error_code=",GetLastError()); LogStop("trace_open_failed",0); return; }
   if(FileSize(file)>0) { FileClose(file); LogStop("existing_run_output",0); return; }
   Print("Yosemite TRACE_OPENED run_id=",RUN_ID);
   string symbols[3]={"EURUSD","GBPUSD","USDJPY"};
   bool complete=true;
   int acknowledged_frames=0;
   string stop_reason="completed";
   for(int sequence=0; sequence<3 && !IsStopped(); sequence++)
   {
      if(!Safe()) { complete=false; stop_reason="safety_changed_before_frame"; break; }
      string rows="";
      for(int index=0; index<3; index++)
      {
         string symbol=symbols[index];
         bool visible=(bool)SymbolInfoInteger(symbol,SYMBOL_VISIBLE);
         MqlTick tick={};
         long counter_before=(long)GetMicrosecondCount();
         long local_before=(long)TimeLocal();
         long gmt_before=(long)TimeGMT();
         long current_before=(long)TimeCurrent();
         long estimate_before=(long)TimeTradeServer();
         ResetLastError();
         bool ok=visible && SymbolInfoTick(symbol,tick);
         int error=GetLastError();
         long gmt_after=(long)TimeGMT();
         long counter_after=(long)GetMicrosecondCount();
         if(index>0) rows+=",";
         rows+="{\"symbol\":\""+symbol+"\",\"visible\":"+Boolean(visible)
            +",\"tickOk\":"+Boolean(ok)+",\"errorCode\":"+IntegerToString(error)
            +",\"TimeLocal\":"+Number(local_before)+",\"TimeGMT\":"+Number(gmt_before)
            +",\"TimeCurrent\":"+Number(current_before)+",\"TimeTradeServer\":"+Number(estimate_before)
            +",\"TimeGMTAfter\":"+Number(gmt_after)+",\"counterBeforeUs\":"+Number(counter_before)
            +",\"counterAfterUs\":"+Number(counter_after)+",\"time\":"+Number((long)tick.time)
            +",\"time_msc\":"+Number(tick.time_msc)+",\"bid\":"+DoubleToString(tick.bid,8)
            +",\"ask\":"+DoubleToString(tick.ask,8)+"}";
      }
      bool safe_after=Safe();
      string frame="{\"type\":\"native_frame\",\"runId\":\""+RUN_ID+"\",\"sequence\":"+IntegerToString(sequence)
         +",\"build\":"+IntegerToString((int)TerminalInfoInteger(TERMINAL_BUILD))
         +",\"server\":\"MetaQuotes-Demo\",\"connected\":"+Boolean((bool)TerminalInfoInteger(TERMINAL_CONNECTED))
         +",\"algoTradingAllowed\":"+Boolean((bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
         +",\"safeAfter\":"+Boolean(safe_after)+",\"rows\":["+rows+"]}";
      if(FileWriteString(file,frame+"\r\n")==0)
      { complete=false; stop_reason="trace_write_failed"; Print("Yosemite FILE_WRITE error_code=",GetLastError()); break; }
      FileFlush(file);
      if(!safe_after) { complete=false; stop_reason="safety_changed_after_frame"; break; }
      Print("Yosemite FRAME sequence=",sequence," written; waiting for collector ACK file=",AckFile(sequence)," protocol=YMT5-1 (maximum 100 seconds)");
      bool acknowledged=false;
      bool safety_lost=false;
      for(int attempt=0; attempt<ACK_WAIT_MILLISECONDS/50 && !IsStopped(); attempt++)
      {
         if(!Safe()) { safety_lost=true; break; }
         if(!CollectorReady()) break;
         if(ProtocolMatches(AckFile(sequence),ProtocolPayload(IntegerToString(sequence))))
         { acknowledged=true; break; }
         Sleep(50);
      }
      if(!acknowledged)
      {
         complete=false;
         stop_reason=IsStopped() ? "stopped_while_waiting_for_ack" : safety_lost ? "safety_changed_while_waiting_for_ack" : !CollectorReady() ? "collector_closed_while_waiting_for_ack" : "collector_ack_timeout";
         break;
      }
      acknowledged_frames++;
      Print("Yosemite ACK sequence=",sequence," received");
      if(sequence<2) Sleep(2000);
   }
   bool safe_at_end=Safe();
   complete=complete && safe_at_end && !IsStopped() && acknowledged_frames==3;
   if(!complete && stop_reason=="completed")
      stop_reason=!safe_at_end ? "safety_changed_at_shutdown" : IsStopped() ? "stopped_before_completion" : "incomplete_frame_count";
   FileWriteString(file,"{\"type\":\"done\",\"runId\":\""+RUN_ID+"\",\"complete\":"+Boolean(complete)+",\"reason\":\""+stop_reason+"\",\"acknowledgedFrames\":"+IntegerToString(acknowledged_frames)+",\"executionAllowed\":false}\r\n");
   FileFlush(file);
   FileClose(file);
   LogStop(stop_reason,acknowledged_frames);
}
